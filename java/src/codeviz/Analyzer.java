package codeviz;

import javax.tools.*;
import javax.lang.model.element.*;
import javax.lang.model.type.*;
import com.sun.source.util.*;
import com.sun.source.tree.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;

public final class Analyzer {
    static class Source extends SimpleJavaFileObject {
        final String content;
        Source(String name,String content){super(URI.create("string:///"+name.replace('.','/')+Kind.SOURCE.extension),Kind.SOURCE);this.content=content;}
        @Override public CharSequence getCharContent(boolean ignored){return content;}
    }
    public static void main(String[] args) throws Exception { System.out.println(Json.stringify(analyze(Path.of(args[0])))); }
    static Map<String,Object> analyze(Path job) throws Exception {
        String source=Files.readString(job.resolve("Source.java"));
        JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
        if(compiler==null)throw new IllegalStateException("A full JDK is required");
        String file="Source";
        try(StandardJavaFileManager fm=compiler.getStandardFileManager(null,null,null)){
            JavacTask parse=(JavacTask)compiler.getTask(null,fm,d->{},List.of("-proc:none"),null,List.of(new Source(file,source)));
            CompilationUnitTree unit=parse.parse().iterator().next();
            for(Tree t:unit.getTypeDecls())if(t instanceof ClassTree c){if(file.equals("Source")||c.getModifiers().getFlags().contains(Modifier.PUBLIC))file=c.getSimpleName().toString();if(c.getModifiers().getFlags().contains(Modifier.PUBLIC))break;}
        }
        List<Object> diagnostics=new ArrayList<>(),entries=new ArrayList<>(),warnings=new ArrayList<>();
        Files.createDirectories(job.resolve("classes"));
        try(StandardJavaFileManager fm=compiler.getStandardFileManager(null,null,null)){
            DiagnosticCollector<JavaFileObject> dc=new DiagnosticCollector<>();
            JavacTask task=(JavacTask)compiler.getTask(null,fm,dc,List.of("-proc:none","-g:lines,vars,source","-parameters","-encoding","UTF-8","-classpath",job.resolve("empty-classpath").toString(),"-d",job.resolve("classes").toString()),null,List.of(new Source(file,source)));
            CompilationUnitTree unit=task.parse().iterator().next();
            task.analyze();
            Trees trees=Trees.instance(task);
            final String filename=file+".java";
            String pkg=unit.getPackageName()==null?"":unit.getPackageName().toString();
            if(pkg.equals("codeviz") || pkg.startsWith("codeviz.")) diagnostics.add(Json.map("severity","error","message","The codeviz package is reserved for the runner.","line",1));
            new TreePathScanner<Void,Void>() {
                @Override public Void visitMethod(MethodTree method,Void unused){
                    Element raw=trees.getElement(getCurrentPath());
                    if(!(raw instanceof ExecutableElement e) || e.getKind()!=ElementKind.METHOD || !e.getModifiers().contains(Modifier.PUBLIC))return super.visitMethod(method,unused);
                    TypeElement owner=(TypeElement)e.getEnclosingElement();
                    String className=task.getElements().getBinaryName(owner).toString();
                    boolean isStatic=e.getModifiers().contains(Modifier.STATIC);
                    boolean constructible=!owner.getModifiers().contains(Modifier.ABSTRACT) && owner.getKind()==ElementKind.CLASS && (owner.getNestingKind()==NestingKind.TOP_LEVEL || owner.getModifiers().contains(Modifier.STATIC));
                    boolean noArg=false;
                    for(Element child:owner.getEnclosedElements())if(child.getKind()==ElementKind.CONSTRUCTOR){ExecutableElement ctor=(ExecutableElement)child;if(ctor.getParameters().isEmpty()&&!ctor.getModifiers().contains(Modifier.PRIVATE))noArg=true;}
                    constructible &= noArg;
                    List<Object> params=new ArrayList<>();List<String> parameterTypes=new ArrayList<>();
                    String descriptor="(";boolean supported=e.getTypeParameters().isEmpty();
                    for(VariableElement p:e.getParameters()){
                        TypeMirror type=task.getTypes().erasure(p.asType());Map<String,Object> input=inputType(type,0);if(input.get("kind").equals("unsupported"))supported=false;
                        params.add(Json.map("id","p"+params.size(),"name",p.getSimpleName().toString(),"type",input));parameterTypes.add(type.toString());descriptor+=descriptor(type);
                    }
                    descriptor+=")"+descriptor(task.getTypes().erasure(e.getReturnType()));
                    boolean main=isStatic && e.getSimpleName().contentEquals("main") && parameterTypes.equals(List.of("java.lang.String[]")) && e.getReturnType().getKind()==TypeKind.VOID;
                    String reason=!isStatic&&!constructible?"Instance entry points need a concrete class with a non-private no-argument constructor.":!supported?"This signature has an unsupported input type or unresolved generic parameters.":null;
                    long offset=trees.getSourcePositions().getStartPosition(unit,method);
                    entries.add(Json.map("id",className+"#"+e.getSimpleName()+descriptor,"className",className,"methodName",e.getSimpleName().toString(),"descriptor",descriptor,"displayName",owner.getSimpleName()+"."+e.getSimpleName()+"("+String.join(", ",e.getParameters().stream().map(p->p.asType()+" "+p.getSimpleName()).toList())+")","mode",main?"program":"method","isStatic",isStatic,"constructible",constructible,"parameters",params,"parameterTypes",parameterTypes,"returnType",e.getReturnType().toString(),"supported",reason==null,"reason",reason,"line",Math.max(1,unit.getLineMap().getLineNumber(Math.max(0,offset)))));
                    return super.visitMethod(method,unused);
                }
            }.scan(unit,null);
            Map<Long,Integer> perLine=new HashMap<>();
            new TreeScanner<Void,Void>(){
                final Set<Tree> ignored=Collections.newSetFromMap(new IdentityHashMap<>());
                @Override public Void visitMethod(MethodTree method,Void v){ignored.addAll(method.getParameters());return super.visitMethod(method,v);}
                @Override public Void visitForLoop(ForLoopTree loop,Void v){ignored.addAll(loop.getInitializer());ignored.addAll(loop.getUpdate());return super.visitForLoop(loop,v);}
                @Override public Void scan(Tree tree,Void v){if(tree!=null){boolean statement=!ignored.contains(tree)&&(tree instanceof ExpressionStatementTree || tree instanceof ReturnTree || tree instanceof VariableTree);long start=trees.getSourcePositions().getStartPosition(unit,tree),end=trees.getSourcePositions().getEndPosition(unit,tree);if(start>=0&&end>start&&statement)perLine.merge(unit.getLineMap().getLineNumber(start),1,Integer::sum);if(start>=0&&end>=start&&(tree instanceof ForLoopTree || tree instanceof WhileLoopTree || tree instanceof DoWhileLoopTree)&&unit.getLineMap().getLineNumber(start)==unit.getLineMap().getLineNumber(Math.max(start,end-1)))warnings.add(Json.map("line",unit.getLineMap().getLineNumber(start),"message","Compact loop: line tracing may group or miss intermediate iterations. Split statements onto separate lines for more detail."));}return super.scan(tree,v);}
            }.scan(unit,null);
            perLine.forEach((line,count)->{if(count>1)warnings.add(Json.map("line",line,"message","Multiple operations share this line; intermediate values may be grouped."));});
            for(Diagnostic<? extends JavaFileObject> d:dc.getDiagnostics())diagnostics.add(Json.map("severity",d.getKind()==Diagnostic.Kind.ERROR?"error":"warning","message",d.getMessage(Locale.ENGLISH),"line",Math.max(1,d.getLineNumber()),"column",d.getPosition()<0?null:d.getPosition()-unit.getLineMap().getStartPosition(unit.getLineMap().getLineNumber(d.getPosition()))+1));
            boolean valid=diagnostics.stream().map(Json::object).noneMatch(d->d.get("severity").equals("error"));
            List<Conditions.Site> conditionSites=valid?Conditions.collect(unit,trees,source):List.of();
            List<Object> conditions=new ArrayList<>();
            if(valid){task.generate();conditions=Conditions.compile(job,filename,source,conditionSites);}
            List<String> classNames=new ArrayList<>();try(var paths=Files.walk(job.resolve("classes"))){paths.filter(p->p.toString().endsWith(".class")).forEach(p->classNames.add(job.resolve("classes").relativize(p).toString().replace('\\','.').replace('/','.').replaceAll("\\.class$","")));}
            return Json.map("schemaVersion",1,"valid",valid,"fileName",filename,"entryPoints",entries,"diagnostics",diagnostics,"warnings",warnings,"conditions",conditions,"classNames",classNames,"runtimeVersion",System.getProperty("java.version"));
        }
    }
    static String descriptor(TypeMirror t){return switch(t.getKind()){case BOOLEAN->"Z";case BYTE->"B";case SHORT->"S";case INT->"I";case LONG->"J";case CHAR->"C";case FLOAT->"F";case DOUBLE->"D";case VOID->"V";case ARRAY->"["+descriptor(((ArrayType)t).getComponentType());default->"L"+((TypeElement)((DeclaredType)t).asElement()).getQualifiedName().toString().replace('.','/')+";";};}
    static Map<String,Object> inputType(TypeMirror type,int depth){
        String t=type.toString();if(type.getKind()==TypeKind.ARRAY){if(depth>=2)return Json.map("kind","unsupported","languageType",t);Map<String,Object> element=inputType(((ArrayType)type).getComponentType(),depth+1);return Json.map("kind",element.get("kind").equals("unsupported")?"unsupported":"array","languageType",t,"element",element,"nullable",true);}
        if(t.equals("java.lang.String"))return Json.map("kind","string","languageType",t,"nullable",true);
        return switch(type.getKind()){
            case BOOLEAN->Json.map("kind","boolean","languageType",t);
            case CHAR->Json.map("kind","character","languageType",t);
            case BYTE,SHORT,INT,LONG->{String min=type.getKind()==TypeKind.BYTE?"-128":type.getKind()==TypeKind.SHORT?"-32768":type.getKind()==TypeKind.INT?"-2147483648":"-9223372036854775808";String max=type.getKind()==TypeKind.BYTE?"127":type.getKind()==TypeKind.SHORT?"32767":type.getKind()==TypeKind.INT?"2147483647":"9223372036854775807";yield Json.map("kind","integer","languageType",t,"min",min,"max",max);}
            case FLOAT,DOUBLE->Json.map("kind","float","languageType",t);
            default->Json.map("kind","unsupported","languageType",t);
        };
    }
}
