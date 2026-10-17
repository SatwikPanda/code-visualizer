package codeviz;

import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;

public final class Harness {
    public static void invocationStart(String signature) { /* JDI boundary after setup. */ }
    public static void completion(Throwable failure) { /* JDI reads the argument. */ }
    public static void main(String[] argv) {
        try {
            Map<String,Object> payload=Json.object(Json.parse(Files.readString(Path.of(argv[0]))));
            System.setIn(new java.io.ByteArrayInputStream(((String)payload.getOrDefault("stdin","")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            Map<String,Object> entry=Json.object(payload.get("entry"));
            Class<?> owner=Class.forName((String)entry.get("className"));
            List<Object> typeNames=Json.array(entry.get("parameterTypes"));Class<?>[] types=new Class<?>[typeNames.size()];for(int i=0;i<types.length;i++)types[i]=type((String)typeNames.get(i));
            Method method=owner.getDeclaredMethod((String)entry.get("methodName"),types);method.setAccessible(true);
            Object receiver=null;if(!Modifier.isStatic(method.getModifiers())){Constructor<?> constructor=owner.getDeclaredConstructor();constructor.setAccessible(true);receiver=constructor.newInstance();}
            List<Object> raw=Json.array(payload.get("args"));Object[] args=new Object[types.length];for(int i=0;i<types.length;i++)args[i]=decode(raw.get(i),types[i]);
            invocationStart((String)entry.get("id"));
            method.invoke(receiver,args);
            completion(null);
        } catch(Throwable failure) {
            if(failure instanceof InvocationTargetException && failure.getCause()!=null)failure=failure.getCause();
            completion(failure);
        }
    }
    static Class<?> type(String name) throws Exception {if(name.endsWith("[]"))return Array.newInstance(type(name.substring(0,name.length()-2)),0).getClass();return switch(name){case "boolean"->boolean.class;case "byte"->byte.class;case "short"->short.class;case "int"->int.class;case "long"->long.class;case "float"->float.class;case "double"->double.class;case "char"->char.class;default->Class.forName(name);};}
    static Object decode(Object value,Class<?> type){
        if(value==null){if(type.isPrimitive())throw new IllegalArgumentException("Primitive input cannot be null");return null;}
        if(type.isArray()){List<Object> values=Json.array(value);if(values.size()>10000)throw new IllegalArgumentException("Array input too large");Object a=Array.newInstance(type.getComponentType(),values.size());for(int i=0;i<values.size();i++)Array.set(a,i,decode(values.get(i),type.getComponentType()));return a;}
        if(type==String.class){if(!(value instanceof String))throw new IllegalArgumentException("Expected string");return value;}
        String s=value.toString();if(type==boolean.class){if(!(value instanceof Boolean))throw new IllegalArgumentException("Expected boolean");return value;}if(type==char.class){if(s.length()!=1)throw new IllegalArgumentException("Expected one UTF-16 code unit");return s.charAt(0);}
        if(type==byte.class)return Byte.valueOf(s);if(type==short.class)return Short.valueOf(s);if(type==int.class)return Integer.valueOf(s);if(type==long.class)return Long.valueOf(s);if(type==float.class)return Float.valueOf(s);if(type==double.class)return Double.valueOf(s);throw new IllegalArgumentException("Unsupported input type");
    }
}
