// Compiled into the submitted translation unit. Trace output uses a separate file,
// so stdout/stderr retain their original contents.
export const CPP_RUNTIME = String.raw`
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iterator>
#include <list>
#include <map>
#include <memory>
#include <optional>
#include <queue>
#include <ranges>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
namespace codeviz {
inline std::ofstream trace("trace.jsonl", std::ios::binary);
inline int count = 0, next_frame = 0;
inline std::vector<std::string> frames;
inline std::string quote(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c < 32) { const char* hex = "0123456789abcdef"; out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
    else out += c;
  }
  return out + "\"";
}
inline void emit(const std::string& s) {
  if (++count > 8500) {
    trace << "{\"kind\":\"limit\",\"message\":\"C++ trace limit reached\"}\n" << std::flush;
    std::exit(0);
  }
  trace << s << '\n' << std::flush;
}
template<class T> std::string address(const T* p) { std::ostringstream s; s << static_cast<const void*>(p); return s.str(); }
template<class T> struct container_name { static constexpr const char* value = "array"; };
template<class T, class A> struct container_name<std::vector<T,A>> { static constexpr const char* value = "vector"; };
template<class T, class A> struct container_name<std::deque<T,A>> { static constexpr const char* value = "deque"; };
template<class T, class A> struct container_name<std::list<T,A>> { static constexpr const char* value = "list"; };
template<class K, class C, class A> struct container_name<std::set<K,C,A>> { static constexpr const char* value = "set"; };
template<class K, class H, class E, class A> struct container_name<std::unordered_set<K,H,E,A>> { static constexpr const char* value = "set"; };
template<class K, class V, class C, class A> struct container_name<std::map<K,V,C,A>> { static constexpr const char* value = "map"; };
template<class K, class V, class H, class E, class A> struct container_name<std::unordered_map<K,V,H,E,A>> { static constexpr const char* value = "map"; };
template<class T> std::string value(const T& v, int depth = 0);
template<class T> struct optional_type : std::false_type {};
template<class T> struct optional_type<std::optional<T>> : std::true_type {};
template<class T> struct pair_type : std::false_type {};
template<class K, class V> struct pair_type<std::pair<K,V>> : std::true_type {};
template<class T> struct stack_type : std::false_type {};
template<class T, class C> struct stack_type<std::stack<T,C>> : std::true_type {};
template<class T> struct queue_type : std::false_type {};
template<class T, class C> struct queue_type<std::queue<T,C>> : std::true_type {};
template<class T, class C, class P> struct queue_type<std::priority_queue<T,C,P>> : std::true_type {};
template<class T> std::string value(const T& v, int depth) {
  using U = std::remove_cvref_t<T>;
  if (depth > 4) return R"({"kind":"unavailable","reason":"Preview depth limit"})";
  if constexpr (std::is_same_v<U, bool>) return std::string(R"({"kind":"boolean","value":)") + (v ? "true}" : "false}");
  else if constexpr (std::is_same_v<U,char>) return R"({"kind":"char","value":)" + quote(std::string(1,v)) + "}";
  else if constexpr (std::is_integral_v<U>) return R"({"kind":"integer","text":)" + quote(std::to_string(v)) + "}";
  else if constexpr (std::is_floating_point_v<U>) { std::ostringstream s; s << std::setprecision(17) << v; return R"({"kind":"float","text":)" + quote(s.str()) + "}"; }
  else if constexpr (std::is_convertible_v<const T&, std::string_view>) {
    std::string_view s(v); return R"({"kind":"string","value":)" + quote(std::string(s.substr(0,512))) + (s.size()>512 ? R"(,"truncated":true})" : "}");
  }
  else if constexpr (optional_type<U>::value) return v ? R"({"kind":"object","type":"optional","fields":{"value":)" + value(*v,depth+1) + "}}" : R"({"kind":"null"})";
  else if constexpr (pair_type<U>::value) return R"({"kind":"object","type":"pair","fields":{"key":)" + value(v.first,depth+1) + R"(,"value":)" + value(v.second,depth+1) + "}}";
  else if constexpr (stack_type<U>::value || queue_type<U>::value) {
    if constexpr (std::is_copy_constructible_v<U>) {
      auto copy = v; std::string items; int n=0;
      while (!copy.empty() && n++ < 64) { if(!items.empty()) items+=','; if constexpr (stack_type<U>::value || requires { copy.top(); }) items+=value(copy.top(),depth+1); else items+=value(copy.front(),depth+1); copy.pop(); }
      return std::string(R"({"kind":"array","container":)") + quote(stack_type<U>::value ? "stack" : "queue") + R"(,"refId":)" + quote(address(&v)) + R"(,"length":)" + std::to_string(v.size()) + R"(,"items":[)" + items + R"(],"truncated":)" + (v.size()>64 ? "true}" : "false}");
    } else return R"({"kind":"unavailable","reason":"Non-copyable container adaptor"})";
  }
  else if constexpr (std::ranges::range<const T> && std::ranges::sized_range<const T>) {
    std::string items; int n=0;
    for (const auto& item : v) { if(n++ == 64) break; if(!items.empty()) items+=','; items+=value(item,depth+1); }
    std::string capacity;
    if constexpr (requires { v.capacity(); }) capacity = R"(,"capacity":)" + std::to_string(v.capacity());
    return R"({"kind":"array","container":)" + quote(container_name<U>::value) + R"(,"refId":)" + quote(address(&v)) + R"(,"length":)" + std::to_string(std::ranges::size(v)) + capacity + R"(,"items":[)" + items + R"(],"truncated":)" + (std::ranges::size(v)>64 ? "true}" : "false}");
  }
  else if constexpr (std::is_pointer_v<U>) return v ? R"({"kind":"reference","type":"pointer","refId":)" + quote(address(v)) + "}" : R"({"kind":"null"})";
  else if constexpr (requires { v.get(); }) return v ? R"({"kind":"object","type":"smart pointer","refId":)" + quote(address(v.get())) + R"(,"fields":{"value":)" + value(*v,depth+1) + "}}" : R"({"kind":"null"})";
  else if constexpr (requires { std::tuple_size<U>::value; }) {
    std::string items; std::apply([&](const auto&... xs) { ((items += (items.empty()?"":",") + value(xs,depth+1)),...); }, v);
    return R"({"kind":"array","container":"tuple","items":[)" + items + "],\"length\":" + std::to_string(std::tuple_size_v<U>) + "}";
  }
  else return R"({"kind":"unavailable","reason":"This type has no safe preview"})";
}
template<class T> std::string binding(const char* id, const char* name, const char* type, const T& v) {
  return R"({"id":)" + quote(id) + R"(,"name":)" + quote(name) + R"(,"type":)" + quote(type) + R"(,"value":)" + value(v) + "}";
}
struct IteratorState { const void* data; size_t size; bool invalid; };
inline std::map<std::string,IteratorState> iterators;
template<class I, class C> std::string iterator_binding(const std::string& frame, const char* id, const char* name, const char* type, const I& it, const C& c) {
  std::string target = R"({"refId":)" + quote(address(&c));
  const void* data = &c;
  if constexpr (requires { c.data(); }) data = c.data();
  auto key=frame+id;
  auto old=iterators.find(key);
  bool uncertain=old!=iterators.end() && (old->second.invalid || old->second.data!=data || old->second.size>c.size());
  iterators[key]={data,c.size(),uncertain};
  if constexpr (std::contiguous_iterator<I> && requires { c.data(); }) {
    // to_address does not dereference an iterator. Integer address checks avoid
    // comparisons between an invalidated iterator and a new allocation.
    const auto pos=reinterpret_cast<std::uintptr_t>(std::to_address(it));
    const auto begin=reinterpret_cast<std::uintptr_t>(c.data());
    const auto stride=sizeof(*c.data()), finish=begin+c.size()*stride;
    if(pos<begin || pos>finish || (pos-begin)%stride) target+=R"(,"invalidated":true)";
    else if(pos==finish) target+=R"(,"end":true)";
    else target+=R"(,"index":)"+std::to_string((pos-begin)/stride);
  }
  else if (uncertain) target += R"(,"unavailable":true)";
  else if constexpr (requires { it == c.end(); it == c.begin(); }) {
    if(it == c.end()) target += R"(,"end":true)";
    else { size_t i=0; bool found=false; for(auto cur=c.begin();cur!=c.end() && i<10000;++cur,++i) if(cur==it) { target+=R"(,"index":)"+std::to_string(i); found=true; break; } if(!found) target+=R"(,"invalidated":true)"; }
  } else if constexpr (requires { it == c.rend(); }) {
    if(it == c.rend()) target += R"(,"end":true)";
    else { size_t i=c.size(); for(auto cur=c.rbegin();cur!=c.rend() && i>0;++cur) { --i; if(cur==it) { target+=R"(,"index":)"+std::to_string(i); break; } } }
  }
  return R"({"id":)"+quote(id)+R"(,"name":)"+quote(name)+R"(,"type":)"+quote(type)+R"(,"value":{"kind":"iterator","pointsTo":)"+target+"}}}";
}
inline std::string variables(std::initializer_list<std::string> values) { std::string out; for(const auto& v:values) { if(!out.empty()) out+=','; out+=v; } return "["+out+"]"; }
struct Frame {
  std::string id, method; int last; bool returned=false;
  Frame(const char* name,int line):id("cpp-"+std::to_string(++next_frame)),method(name),last(line) {
    std::string parent=frames.empty()?"":R"(,"parentFrameId":)"+quote(frames.back());
    emit(R"({"kind":"frame-enter","frameId":)"+quote(id)+R"(,"method":)"+quote(method)+R"(,"className":"C++")"+parent+R"(,"line":)"+std::to_string(line)+"}"); frames.push_back(id);
  }
  void observe(int line,const std::string& vars,const char* phase="after-instruction",const std::string& condition="") {
    last=line; emit(R"({"kind":"observation","frameId":)"+quote(id)+R"(,"method":)"+quote(method)+R"(,"line":)"+std::to_string(line)+R"(,"phase":)"+quote(phase)+R"(,"variables":)"+vars+condition+"}");
  }
  void finish(const std::string& v) { returned=true; emit(R"({"kind":"frame-return","frameId":)"+quote(id)+R"(,"method":)"+quote(method)+R"(,"root":)"+(frames.size()==1?"true":"false")+R"(,"line":)"+std::to_string(last)+R"(,"value":)"+v+"}"); }
  ~Frame() { if(!returned) finish(R"({"kind":"void"})"); frames.pop_back(); }
};
template<class F> bool test(Frame& f,int line,const char* id,bool result,F&& vars) { f.observe(line,vars(),"condition",R"(,"condition":{"id":)"+quote(id)+R"(,"value":)"+(result?"true}":"false}")); return result; }
template<class T,class F> decltype(auto) returned(Frame& f,int line,T&& v,F&& vars) { f.observe(line,vars(),"return"); f.finish(value(v)); return std::forward<T>(v); }
}
`;
