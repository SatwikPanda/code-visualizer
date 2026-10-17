package codeviz;

import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Real JVM recording. Never re-evaluates application expressions or invokes display methods. */
public final class Tracer {
    VirtualMachine vm; Process target;
    final Map<Long,List<Call>> stacks=new HashMap<>();
    final Map<LocalVariable,String> symbols=new HashMap<>();
    final Set<String> users=new HashSet<>(),breakpoints=new HashSet<>();
    final Map<String,List<Object>> conditionOperands=new HashMap<>();
    String selected,rootId; long rootThread=-1; boolean armed=false,completed=false;
    Object rootReturn=null; int calls=0,symbolCount=0,events=0,bytes=0,outputBytes=0;
    long started=System.nanoTime();
    static final int MAX_EVENTS=10000,MAX_BYTES=8*1024*1024;
    record Call(String id,Method method,String parent,boolean setup){}
    static class Limited extends RuntimeException { Limited(String message){super(message);} }
    public static void main(String[] args) throws Exception {
        Tracer tracer=new Tracer();
        try { tracer.run(Path.of(args[0]),args.length>1?args[1]:null); }
        catch(Limited e){tracer.forceEvent(Json.map("kind","limit","message",e.getMessage()));}
        catch(Exception e){tracer.forceEvent(Json.map("kind","engine-error","message",e.getClass().getSimpleName()+": "+e.getMessage()));}
        finally{if(tracer.vm!=null)try{tracer.vm.exit(0);}catch(Exception ignored){}if(tracer.target!=null)tracer.target.destroyForcibly();}
    }
    void run(Path job,String attach) throws Exception {
        Map<String,Object> payload=Json.object(Json.parse(Files.readString(job.resolve("invocation.json"))));
        Map<String,Object> entry=Json.object(payload.get("entry"));selected=(String)entry.get("id");
        for(Object name:Json.array(payload.get("classNames")))users.add((String)name);
        if(attach==null){
            LaunchingConnector connector=Bootstrap.virtualMachineManager().defaultConnector();Map<String,Connector.Argument> arguments=connector.defaultArguments();
            String classpath=System.getProperty("java.class.path")+File.pathSeparator+job.resolve("classes").toAbsolutePath();
            arguments.get("options").setValue("-Xmx128m -Dfile.encoding=UTF-8 -cp \""+classpath+"\"");
            arguments.get("main").setValue("codeviz.Harness \""+job.resolve("invocation.json").toAbsolutePath()+"\"");
            vm=connector.launch(arguments);target=vm.process();
            pump(target.getInputStream(),"stdout");pump(target.getErrorStream(),"stderr");
            target.getOutputStream().close(); // The harness installs the bounded stdin buffer from the payload.
        }else{
            AttachingConnector connector=Bootstrap.virtualMachineManager().attachingConnectors().stream().filter(c->c.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
            Map<String,Connector.Argument> arguments=connector.defaultArguments();arguments.get("hostname").setValue("127.0.0.1");arguments.get("port").setValue(attach);arguments.get("timeout").setValue("5000");vm=connector.attach(arguments);
        }
        if(!vm.canGetMethodReturnValues())throw new IllegalStateException("This JVM cannot capture method return values");
        EventRequestManager manager=vm.eventRequestManager();
        for(String name:users){ClassPrepareRequest request=manager.createClassPrepareRequest();request.addClassFilter(name);request.setSuspendPolicy(EventRequest.SUSPEND_ALL);request.enable();MethodEntryRequest enter=manager.createMethodEntryRequest();enter.addClassFilter(name);enter.setSuspendPolicy(EventRequest.SUSPEND_ALL);enter.enable();MethodExitRequest exit=manager.createMethodExitRequest();exit.addClassFilter(name);exit.setSuspendPolicy(EventRequest.SUSPEND_ALL);exit.enable();}
        MethodEntryRequest hook=manager.createMethodEntryRequest();hook.addClassFilter("codeviz.Harness");hook.setSuspendPolicy(EventRequest.SUSPEND_ALL);hook.enable();
        MethodEntryRequest conditionHook=manager.createMethodEntryRequest();conditionHook.addClassFilter("codeviz.Probe");conditionHook.setSuspendPolicy(EventRequest.SUSPEND_ALL);conditionHook.enable();
        ExceptionRequest exceptions=manager.createExceptionRequest(null,true,true);exceptions.setSuspendPolicy(EventRequest.SUSPEND_ALL);exceptions.enable();
        for(ReferenceType type:vm.allClasses())if(users.contains(type.name()))prepare(type);
        emit(Json.map("kind","run-start","runtimeVersion",vm.version()));
        boolean alive=true;
        while(alive){
            if((System.nanoTime()-started)/1_000_000>15000)throw new Limited("Traced execution exceeded 15 seconds");
            EventSet set=vm.eventQueue().remove(250);if(set==null)continue;
            try{
                for(Event event:set){
                    if(event instanceof VMStartEvent)continue;
                    if(event instanceof ClassPrepareEvent e){prepare(e.referenceType());continue;}
                    if(event instanceof VMDeathEvent || event instanceof VMDisconnectEvent){alive=false;continue;}
                    if(!(event instanceof LocatableEvent e))continue;
                    if(e instanceof MethodEntryEvent enter && enter.method().declaringType().name().equals("codeviz.Harness")){
                        if(enter.method().name().equals("invocationStart")){armed=true;rootThread=e.thread().uniqueID();}
                        if(enter.method().name().equals("completion")){
                            Value failure=e.thread().frame(0).getArgumentValues().get(0);reconcile(e.thread());
                            if(failure instanceof ObjectReference object)emit(Json.map("kind","result","outcome","threw","error",exception(object)));
                            else emit(Json.map("kind","result","outcome",rootId==null?"aborted":"returned","value",rootReturn));
                            completed=true;
                        }
                        continue;
                    }
                    if(e instanceof MethodEntryEvent enter && enter.method().declaringType().name().equals("codeviz.Probe")){
                        if(rootId!=null && e.thread().uniqueID()!=rootThread)throw new Limited("CONCURRENCY_NOT_SUPPORTED: user code executed on another thread");
                        List<Value> arguments=e.thread().frame(0).getArgumentValues();
                        if(arguments.isEmpty())continue;
                        reconcile(e.thread());List<Call> stack=stacks.get(e.thread().uniqueID());
                        if(stack==null || stack.isEmpty())continue;
                        String id=((StringReference)arguments.get(0)).value();
                        String key=stack.get(stack.size()-1).id()+":"+id;
                        if(enter.method().name().equals("begin"))conditionOperands.put(key,new ArrayList<>());
                        else if(enter.method().name().equals("operand")){
                            List<Object> operands=conditionOperands.get(key);
                            if(operands!=null && operands.size()<24)operands.add(Json.map("id",((StringReference)arguments.get(1)).value(),"value",value(arguments.get(2),0,new HashSet<>(),new int[]{0})));
                        }else if(enter.method().name().equals("condition")){
                            boolean outcome=((BooleanValue)arguments.get(2)).value();
                            List<Object> operands=conditionOperands.remove(key);
                            snapshot(e.thread(),"condition",Json.map("id",id,"value",outcome,"operands",operands==null?List.of():operands));
                        }
                        continue;
                    }
                    if(e instanceof ExceptionEvent thrown){
                        if(userFrames(e.thread()).isEmpty())continue;
                        snapshot(e.thread(),"exception");emit(Json.map("kind","exception","error",exception(thrown.exception()),"line",userFrames(e.thread()).get(0).location().lineNumber(),"caught",thrown.catchLocation()!=null));continue;
                    }
                    if(!users.contains(e.location().declaringType().name()))continue;
                    if(rootId!=null && e.thread().uniqueID()!=rootThread)throw new Limited("CONCURRENCY_NOT_SUPPORTED: user code executed on another thread");
                    reconcile(e.thread());
                    if(e instanceof MethodEntryEvent enter){
                        List<Call> stack=stacks.computeIfAbsent(e.thread().uniqueID(),x->new ArrayList<>());
                        // Reconciliation creates the newly entered frame. Arm only the requested invocation.
                        Call call=stack.get(stack.size()-1);
                        String signature=enter.method().declaringType().name()+"#"+enter.method().name()+enter.method().signature();
                        if(armed&&rootId==null&&signature.equals(selected)&&e.thread().uniqueID()==rootThread){rootId=call.id();armed=false;}
                        snapshot(e.thread(),"entry");
                    }else if(e instanceof MethodExitEvent exit){
                        snapshot(e.thread(),"return");List<Call> stack=stacks.get(e.thread().uniqueID());
                        if(stack!=null&&!stack.isEmpty()){Call call=stack.remove(stack.size()-1);Object value=value(exit.returnValue(),0,new HashSet<>(),new int[]{0});emit(Json.map("kind","frame-return","frameId",call.id(),"method",exit.method().name(),"line",exit.location().lineNumber(),"value",value,"root",call.id().equals(rootId)));if(call.id().equals(rootId))rootReturn=value;}
                    }else if(e instanceof BreakpointEvent)snapshot(e.thread(),"before-instruction");
                }
            }finally{try{set.resume();}catch(VMDisconnectedException ignored){}}
        }
        if(target!=null){target.waitFor();for(Thread pump:pumps)pump.join(1000);}
        if(!completed)emit(Json.map("kind","result","outcome","exited","error",Json.map("type","ProcessExit","message","The process ended before the selected invocation completed.")));
        emit(Json.map("kind","run-end"));
    }
    void prepare(ReferenceType type) throws Exception {
        for(Location location:type.allLineLocations()){
            String key=type.name()+"#"+location.method().name()+location.method().signature()+"@"+location.codeIndex();
            if(breakpoints.add(key)){if(breakpoints.size()>15000)throw new Limited("Too many executable locations");BreakpointRequest bp=vm.eventRequestManager().createBreakpointRequest(location);bp.setSuspendPolicy(EventRequest.SUSPEND_ALL);bp.enable();}
        }
    }
    List<StackFrame> userFrames(ThreadReference thread) throws IncompatibleThreadStateException {return thread.frames().stream().filter(f->users.contains(f.location().declaringType().name())).toList();}
    void reconcile(ThreadReference thread) throws Exception {
        List<StackFrame> inner=userFrames(thread);if(inner.size()>256)throw new Limited("Call stack exceeds 256 frames");List<StackFrame> outer=new ArrayList<>(inner);Collections.reverse(outer);
        List<Call> stack=stacks.computeIfAbsent(thread.uniqueID(),x->new ArrayList<>());int common=0;while(common<stack.size()&&common<outer.size()&&stack.get(common).method().equals(outer.get(common).location().method()))common++;
        while(stack.size()>common){Call call=stack.remove(stack.size()-1);conditionOperands.keySet().removeIf(k->k.startsWith(call.id()+":"));emit(Json.map("kind","frame-unwind","frameId",call.id()));}
        while(stack.size()<outer.size()){Method method=outer.get(stack.size()).location().method();String parent=stack.isEmpty()?null:stack.get(stack.size()-1).id();Call call=new Call("f"+(++calls),method,parent,rootId==null&&!armed);stack.add(call);emit(Json.map("kind","frame-enter","frameId",call.id(),"parentFrameId",parent,"method",method.name(),"className",method.declaringType().name(),"setup",call.setup()));}
    }
    void snapshot(ThreadReference thread,String phase) throws Exception {
        snapshot(thread,phase,null);
    }
    void snapshot(ThreadReference thread,String phase,Map<String,Object> condition) throws Exception {
        reconcile(thread);List<StackFrame> frames=userFrames(thread);if(frames.isEmpty())return;
        StackFrame frame=frames.get(0);List<Call> stack=stacks.get(thread.uniqueID());Call call=stack.get(stack.size()-1);
        List<Object> bindings=new ArrayList<>();Set<Long> seen=new HashSet<>();int[] budget={0};
        try{List<LocalVariable> locals=frame.visibleVariables();Map<LocalVariable,Value> values=frame.getValues(locals);for(LocalVariable local:locals){String symbol=symbols.computeIfAbsent(local,x->"v"+(++symbolCount));bindings.add(Json.map("id",call.id()+":"+symbol,"name",local.name(),"type",local.typeName(),"value",value(values.get(local),0,seen,budget)));}}
        catch(AbsentInformationException absent){List<Value> args=frame.getArgumentValues();for(int i=0;i<args.size();i++)bindings.add(Json.map("id",call.id()+":arg"+i,"name","arg"+i,"type",args.get(i)==null?"reference":args.get(i).type().name(),"value",value(args.get(i),0,seen,budget)));}
        ObjectReference receiver=frame.thisObject();if(receiver!=null)bindings.add(Json.map("id",call.id()+":this","name","this","type",receiver.referenceType().name(),"value",value(receiver,0,seen,budget)));
        Map<String,Object> observation=Json.map("kind","observation","frameId",call.id(),"method",frame.location().method().name(),"className",frame.location().declaringType().name(),"threadId",Long.toString(thread.uniqueID()),"line",frame.location().lineNumber(),"phase",phase,"setup",call.setup(),"variables",bindings);
        if(condition!=null)observation.put("condition",condition);
        emit(observation);
    }
    Object exception(ObjectReference error){
        Object message=null;try{Field f=error.referenceType().fieldByName("detailMessage");if(f!=null&&error.getValue(f) instanceof StringReference s)message=s.value();}catch(Exception ignored){}
        return Json.map("type",error.referenceType().name(),"message",message==null?"":message);
    }
    Object value(Value value,int depth,Set<Long> seen,int[] budget){
        try{
            if(value==null)return Json.map("kind","null");
            if(value instanceof VoidValue)return Json.map("kind","void");
            if(value instanceof BooleanValue b)return Json.map("kind","boolean","value",b.value());
            if(value instanceof CharValue c)return Json.map("kind","char","value",String.valueOf(c.value()),"codeUnit",(int)c.value());
            if(value instanceof PrimitiveValue p)return Json.map("kind",value instanceof FloatValue||value instanceof DoubleValue?"float":"integer","type",value.type().name(),"text",p.toString());
            if(value instanceof StringReference s){String text=s.value();return Json.map("kind","string","value",text.substring(0,Math.min(2000,text.length())),"length",text.length(),"truncated",text.length()>2000);}
            ObjectReference object=(ObjectReference)value;String ref="o"+object.uniqueID();
            if(depth>=3||seen.contains(object.uniqueID())||++budget[0]>500)return Json.map("kind","reference","refId",ref,"type",object.referenceType().name(),"truncated",true);
            seen.add(object.uniqueID());
            if(object instanceof ArrayReference array){List<Object> items=new ArrayList<>();for(Value item:array.getValues(0,Math.min(100,array.length())))items.add(value(item,depth+1,seen,budget));return Json.map("kind","array","refId",ref,"type",array.referenceType().name(),"length",array.length(),"items",items,"truncated",array.length()>100);}
            Map<String,Object> fields=new LinkedHashMap<>();if(users.contains(object.referenceType().name()))for(Field field:object.referenceType().allFields())if(!field.isStatic()&&fields.size()<40)fields.put(field.declaringType().name()+"."+field.name(),value(object.getValue(field),depth+1,seen,budget));
            return Json.map("kind","object","refId",ref,"type",object.referenceType().name(),"fields",fields);
        }catch(Exception unavailable){return Json.map("kind","unavailable","reason",unavailable.getClass().getSimpleName());}
    }
    final List<Thread> pumps=new ArrayList<>();
    void pump(InputStream stream,String channel){Thread thread=new Thread(()->{try(Reader reader=new InputStreamReader(stream,StandardCharsets.UTF_8)){char[] buffer=new char[2048];int n;while((n=reader.read(buffer))!=-1){synchronized(this){outputBytes+=n;if(outputBytes>256*1024){if(vm!=null)try{vm.exit(125);}catch(Exception ignored){}forceEvent(Json.map("kind","limit","message","Console output exceeded 256 KiB"));return;}}emit(Json.map("kind","output","channel",channel,"text",new String(buffer,0,n)));}}catch(Exception ignored){}});thread.setDaemon(true);thread.start();pumps.add(thread);}
    synchronized void emit(Map<String,Object> event){event.put("elapsedMs",(System.nanoTime()-started)/1_000_000);String line=Json.stringify(event);int size=line.getBytes(StandardCharsets.UTF_8).length;if(++events>MAX_EVENTS||size>256*1024||(bytes+=size)>MAX_BYTES)throw new Limited("Trace event or byte limit reached");System.out.println(line);System.out.flush();}
    synchronized void forceEvent(Map<String,Object> event){System.out.println(Json.stringify(event));System.out.flush();}
}
