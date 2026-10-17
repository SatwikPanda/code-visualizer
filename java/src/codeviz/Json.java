package codeviz;

import java.util.*;
import java.math.BigDecimal;

/** Small dependency-free JSON codec. Numeric input is kept lossless. */
public final class Json {
    public static Object parse(String input) { Parser p = new Parser(input); Object v = p.value(); p.ws(); if (p.i != input.length()) throw new IllegalArgumentException("Trailing JSON content"); return v; }
    @SuppressWarnings("unchecked") public static Map<String,Object> object(Object v) { return (Map<String,Object>) v; }
    @SuppressWarnings("unchecked") public static List<Object> array(Object v) { return (List<Object>) v; }
    public static String text(Object v) { return String.valueOf(v); }
    public static Map<String,Object> map(Object... pairs) { Map<String,Object> m = new LinkedHashMap<>(); for(int i=0;i<pairs.length;i+=2) m.put((String)pairs[i],pairs[i+1]); return m; }
    public static String stringify(Object v) {
        if(v == null) return "null";
        if(v instanceof String || v instanceof Character) { String s=v.toString(); StringBuilder b=new StringBuilder("\""); for(int i=0;i<s.length();i++){ char c=s.charAt(i); switch(c){case '"':b.append("\\\"");break;case '\\':b.append("\\\\");break;case '\n':b.append("\\n");break;case '\r':b.append("\\r");break;case '\t':b.append("\\t");break;default:if(c<32 || Character.isSurrogate(c))b.append(String.format("\\u%04x",(int)c));else b.append(c);}} return b.append('"').toString(); }
        if(v instanceof Number || v instanceof Boolean) return v.toString();
        if(v instanceof Map<?,?> m){ List<String> x=new ArrayList<>(); m.forEach((k,a)->x.add(stringify(k.toString())+":"+stringify(a)));return "{"+String.join(",",x)+"}"; }
        if(v instanceof Iterable<?> a){List<String>x=new ArrayList<>();for(Object e:a)x.add(stringify(e));return "["+String.join(",",x)+"]";}
        throw new IllegalArgumentException("Unsupported JSON value: "+v.getClass());
    }
    static final class Parser {
        final String s; int i=0,depth=0; Parser(String s){this.s=s;}
        void ws(){while(i<s.length() && Character.isWhitespace(s.charAt(i)))i++;}
        Object value(){ws();if(++depth>64)throw new IllegalArgumentException("JSON nesting limit");try{if(i>=s.length())throw new IllegalArgumentException("Unexpected JSON end");char c=s.charAt(i);if(c=='"')return string();if(c=='{'){i++;Map<String,Object>m=new LinkedHashMap<>();ws();if(take('}'))return m;do{ws();String k=string();ws();expect(':');m.put(k,value());ws();}while(take(','));expect('}');return m;}if(c=='['){i++;List<Object>a=new ArrayList<>();ws();if(take(']'))return a;do{a.add(value());ws();}while(take(','));expect(']');return a;}if(s.startsWith("true",i)){i+=4;return true;}if(s.startsWith("false",i)){i+=5;return false;}if(s.startsWith("null",i)){i+=4;return null;}int start=i;while(i<s.length() && "-+0123456789.eE".indexOf(s.charAt(i))>=0)i++;if(start==i)throw new IllegalArgumentException("Invalid JSON at "+i);return new BigDecimal(s.substring(start,i));}finally{depth--;}}
        boolean take(char c){if(i<s.length()&&s.charAt(i)==c){i++;return true;}return false;}
        void expect(char c){if(!take(c))throw new IllegalArgumentException("Expected "+c+" at "+i);}
        String string(){expect('"');StringBuilder b=new StringBuilder();while(i<s.length()){char c=s.charAt(i++);if(c=='"')return b.toString();if(c=='\\'){if(i>=s.length())break;char e=s.charAt(i++);switch(e){case '"':case '\\':case '/':b.append(e);break;case 'b':b.append('\b');break;case 'f':b.append('\f');break;case 'n':b.append('\n');break;case 'r':b.append('\r');break;case 't':b.append('\t');break;case 'u':if(i+4>s.length())throw new IllegalArgumentException("Invalid Unicode escape");b.append((char)Integer.parseInt(s.substring(i,i+4),16));i+=4;break;default:throw new IllegalArgumentException("Invalid escape");}}else{if(c<32)throw new IllegalArgumentException("Unescaped control character");b.append(c);}}throw new IllegalArgumentException("Unclosed JSON string");}
    }
}
