import type {
  ConditionDefinition,
  EntryPoint,
  InputType,
} from "../../contracts/src/index";

export interface AstNode {
  id?: string;
  kind: string;
  name?: string;
  isImplicit?: boolean;
  storageClass?: string;
  init?: string;
  opcode?: string;
  value?: string;
  type?: { qualType: string; desugaredQualType?: string };
  loc?: Location;
  range?: { begin: Location; end: Location };
  inner?: AstNode[];
  hasElse?: boolean;
  hasInit?: boolean;
  hasVar?: boolean;
}
interface Location {
  offset?: number;
  tokLen?: number;
  expansionLoc?: Location;
  spellingLoc?: Location;
}
interface Variable {
  name: string;
  id: string;
  type: string;
  owner?: string;
}
const quote = JSON.stringify;
export function inputType(type: string, longBits = 64): InputType {
  const t = type
    .replace(/\bconst\b|[&]/g, "")
    .replace(/std::(?:__\w+::)?/g, "")
    .trim();
  const vector = t.match(/^(?:vector|array)\s*<(.+)>$/);
  if (vector) {
    // Only the first template argument is an element type; nested templates stay intact.
    let depth = 0,
      end = vector[1].length;
    for (let i = 0; i < vector[1].length; i++) {
      if (vector[1][i] === "<") depth++;
      if (vector[1][i] === ">") depth--;
      if (vector[1][i] === "," && depth === 0) {
        end = i;
        break;
      }
    }
    const element = inputType(vector[1].slice(0, end), longBits);
    return {
      kind: element.kind === "unsupported" ? "unsupported" : "array",
      languageType: type,
      element,
    };
  }
  if (/^(?:string|basic_string<char.*>)$/.test(t))
    return { kind: "string", languageType: type };
  if (t === "bool") return { kind: "boolean", languageType: type };
  if (t === "char") return { kind: "character", languageType: type };
  if (/^(?:float|double|long double)$/.test(t))
    return { kind: "float", languageType: type };
  if (
    /^(?:(?:unsigned|signed)\s+)?(?:short(?: int)?|int|long(?: long)?(?: int)?|size_t)$/.test(
      t,
    )
  ) {
    const bits = /short/.test(t)
      ? 16
      : /long long|size_t/.test(t)
        ? 64
        : /long/.test(t)
          ? longBits
          : 32;
    const unsigned = /unsigned|size_t/.test(t);
    return {
      kind: "integer",
      languageType: type,
      min: unsigned ? "0" : String(-(1n << BigInt(bits - 1))),
      max: String((1n << BigInt(unsigned ? bits : bits - 1)) - 1n),
    };
  }
  return { kind: "unsupported", languageType: type };
}
export function instrument(
  source: string,
  ast: AstNode,
  prefixBytes: number,
  longBits = 64,
) {
  const bytes = Buffer.from(source),
    edits: { at: number; text: string; order: number }[] = [];
  const conditions: ConditionDefinition[] = [],
    entries: EntryPoint[] = [];
  const loc = (p?: Location): number =>
    (p?.expansionLoc?.offset ?? p?.offset ?? -100000) - prefixBytes;
  const start = (n: AstNode) => loc(n.range?.begin);
  const end = (n: AstNode) =>
    loc(n.range?.end) +
    (n.range?.end.expansionLoc?.tokLen ?? n.range?.end.tokLen ?? 1);
  const text = (n: AstNode) => bytes.subarray(start(n), end(n)).toString();
  const line = (p: number) =>
    bytes.subarray(0, Math.max(0, p)).toString().split("\n").length;
  const column = (p: number) => p - (bytes.lastIndexOf(10, p - 1) + 1) + 1;
  const add = (at: number, s: string, order = 0) => {
    if (at >= 0 && at <= bytes.length) edits.push({ at, text: s, order });
  };
  const statementEnd = (n: AstNode) => {
    let p = end(n);
    while (p < bytes.length && /\s/.test(String.fromCharCode(bytes[p]))) p++;
    return bytes[p] === 59 ? p + 1 : end(n);
  };
  const variable = (n: AstNode): Variable | undefined => {
    if (!n.name || !/^[A-Za-z_]\w*$/.test(n.name) || n.name.startsWith("__"))
      return;
    const type = n.type?.desugaredQualType || n.type?.qualType || "auto";
    const owner = /iterator|__normal_iterator|\*/.test(type)
      ? text(n).match(
          /\b([A-Za-z_]\w*)\s*\.\s*(?:c?r?begin|c?r?end|find|lower_bound|upper_bound|erase|insert)\s*\(/,
        )?.[1]
      : undefined;
    return { name: n.name, id: `local:${start(n)}:${n.name}`, type, owner };
  };
  const extend = (vars: Variable[], more: Variable[]) => [
    ...vars.filter((v) => !more.some((x) => x.name === v.name)),
    ...more,
  ];
  const bindings = (vars: Variable[]) =>
    `codeviz::variables({${vars.map((v) => (v.owner && vars.some((x) => x.name === v.owner) ? `codeviz::iterator_binding(__cvz_frame.id,${quote(v.id)},${quote(v.name)},${quote(v.type)},${v.name},${v.owner})` : `codeviz::binding(${quote(v.id)},${quote(v.name)},${quote(v.type)},${v.name})`)).join(",")}})`;
  const observe = (p: number, vars: Variable[], phase = "after-instruction") =>
    `\n__cvz_frame.observe(${line(p)},${bindings(vars)},${quote(phase)});\n`;
  function declarations(n: AstNode): Variable[] {
    return (n.inner || [])
      .flatMap((x) =>
        x.kind === "DecompositionDecl"
          ? (x.inner || []).filter((b) => b.kind === "BindingDecl")
          : x.kind === "VarDecl" && x.init
            ? [x]
            : [],
      )
      .map(variable)
      .filter((v): v is Variable => !!v);
  }
  function condition(
    n: AstNode,
    vars: Variable[],
    kind: ConditionDefinition["kind"],
  ) {
    const a = start(n),
      b = end(n);
    if (a < 0 || b <= a) return;
    const id = `cpp-condition-${a}`;
    if (conditions.some((x) => x.id === id)) return;
    conditions.push({
      id,
      kind,
      expression: text(n),
      line: line(a),
      column: column(a),
      endLine: line(b),
      endColumn: column(b),
      recordable: true,
    });
    add(
      a,
      `codeviz::test(__cvz_frame,${line(a)},${quote(id)},static_cast<bool>(`,
      5,
    );
    add(b, `),[&]{return ${bindings(vars)};})`, -5);
  }
  function body(n: AstNode, vars: Variable[]) {
    if (n.kind === "CompoundStmt") compound(n, vars);
    else {
      add(start(n), "{", -20);
      statement(n, vars);
      add(statementEnd(n), "}", 20);
    }
  }
  function compound(n: AstNode, outer: Variable[], functionBody = false) {
    let vars = [...outer];
    if (!functionBody)
      add(start(n) + 1, observe(start(n), vars, "block-entry"));
    for (const s of n.inner || []) vars = statement(s, vars);
    add(end(n) - 1, observe(end(n) - 1, vars));
    return vars;
  }
  function statement(n: AstNode, vars: Variable[]): Variable[] {
    if (start(n) < 0 || n.isImplicit) return vars;
    if (n.kind === "CompoundStmt") {
      compound(n, vars);
      return vars;
    }
    if (n.kind === "DeclStmt") {
      add(start(n), observe(start(n), vars, "before-instruction"));
      const next = extend(vars, declarations(n));
      add(statementEnd(n), observe(start(n), next));
      return next;
    }
    if (n.kind === "ReturnStmt") {
      const expr = n.inner?.[0];
      if (expr && text(expr) !== "") {
        add(
          start(expr),
          `codeviz::returned(__cvz_frame,${line(start(n))},(`,
          0,
        );
        add(end(expr), `),[&]{return ${bindings(vars)};})`, 0);
      } else add(start(n), observe(start(n), vars, "return"));
      return vars;
    }
    if (
      n.kind === "IfStmt" ||
      n.kind === "WhileStmt" ||
      n.kind === "DoStmt" ||
      n.kind === "ForStmt" ||
      n.kind === "CXXForRangeStmt"
    ) {
      const children = n.inner || [];
      add(start(n), observe(start(n), vars, "before-instruction"));
      if (n.kind === "ForStmt") {
        const local = extend(
          vars,
          children[0]?.kind === "DeclStmt" ? declarations(children[0]) : [],
        );
        if (children[2]?.kind) condition(children[2], local, "for");
        const b = children.at(-1);
        if (b) body(b, local);
      } else if (n.kind === "CXXForRangeStmt") {
        const decl = children.at(-2),
          b = children.at(-1);
        const local = extend(vars, decl ? declarations(decl) : []);
        if (b) body(b, local);
      } else if (n.kind === "DoStmt") {
        if (children[0]) body(children[0], vars);
        if (children[1]) condition(children[1], vars, "do-while");
      } else {
        const bodyCount = n.kind === "IfStmt" && n.hasElse ? 2 : 1;
        const condIndex = children.length - bodyCount - 1;
        const local = extend(
          vars,
          children
            .slice(0, condIndex)
            .flatMap((x) => (x.kind === "DeclStmt" ? declarations(x) : [])),
        );
        if (children[condIndex])
          condition(
            children[condIndex],
            local,
            n.kind === "IfStmt" ? "if" : "while",
          );
        children.slice(-bodyCount).forEach((x) => body(x, local));
      }
      return vars;
    }
    if (
      n.kind === "SwitchStmt" ||
      n.kind === "CXXTryStmt" ||
      n.kind === "CoroutineBodyStmt"
    )
      throw new Error(
        `C++ tracing does not yet support ${n.kind.replace(/Stmt$/, "")}. Use if/else or ordinary functions for this recording.`,
      );
    if (
      n.kind === "BreakStmt" ||
      n.kind === "ContinueStmt" ||
      n.kind === "GotoStmt"
    ) {
      add(start(n), observe(start(n), vars, "before-instruction"));
      return vars;
    }
    add(start(n), observe(start(n), vars, "before-instruction"));
    add(statementEnd(n), observe(start(n), vars));
    return vars;
  }
  function visit(n: AstNode, path: string[] = [], inRecord = false) {
    if (n.isImplicit) return;
    if (
      (n.kind === "FunctionDecl" || n.kind === "CXXMethodDecl") &&
      n.inner?.some((x) => x.kind === "CompoundStmt")
    ) {
      const b = n.inner.find((x) => x.kind === "CompoundStmt")!;
      const name = [...path, n.name].join("::"),
        params = n.inner.filter((x) => x.kind === "ParmVarDecl");
      const returnType = n.type?.qualType.split(" (")[0] || "void";
      const parameters = params.map((p, i) => ({
        id: `arg-${i}`,
        name: p.name || `arg${i}`,
        type: inputType(p.type?.qualType || "", longBits),
      }));
      const main = n.name === "main" && path.length === 0;
      const supported =
        (!inRecord || n.storageClass === "static") &&
        (main
          ? params.length === 0 || params.length === 2
          : parameters.every((p) => p.type.kind !== "unsupported"));
      entries.push({
        id: `cpp:${name}:${start(n)}`,
        className: "C++",
        methodName: name,
        descriptor: n.type?.qualType || name,
        displayName: `${name}(${params.map((p) => `${p.type?.qualType} ${p.name || ""}`).join(", ")})`,
        mode: main ? "program" : "method",
        isStatic: true,
        constructible: true,
        parameters: main ? [] : parameters,
        parameterTypes: params.map((p) => p.type?.qualType || ""),
        returnType,
        supported,
        reason: supported
          ? undefined
          : "Choose a free/static function with scalar, string, or vector parameters, or main().",
        line: line(start(n)),
      });
      if (n.name === "main" && !path.length) {
        const p = loc(n.loc);
        add(p, "__codeviz_", 0);
      }
      add(
        start(b) + 1,
        `\ncodeviz::Frame __cvz_frame(${quote(name)},${line(start(n))});\n`,
        -10,
      );
      const vars = params.map(variable).filter((v): v is Variable => !!v);
      add(start(b) + 1, observe(start(n), vars, "before-instruction"), 1);
      const finalVars = compound(b, vars, true);
      if (main)
        add(
          end(b) - 1,
          `\nreturn codeviz::returned(__cvz_frame,${line(end(b) - 1)},0,[&]{return ${bindings(finalVars)};});\n`,
          10,
        );
      return;
    }
    const named =
      (n.kind === "NamespaceDecl" && n.name !== "__codeviz_ast_user") ||
      n.kind === "CXXRecordDecl";
    for (const child of n.inner || [])
      visit(
        child,
        named && n.name ? [...path, n.name] : path,
        inRecord || n.kind === "CXXRecordDecl",
      );
  }
  visit(ast);
  // Apply byte offsets from Clang without corrupting UTF-8 source text. Closing
  // edits precede opening edits at the same boundary (single-statement bodies).
  edits.sort((a, b) => a.at - b.at || a.order - b.order);
  let previous = 0,
    result = "";
  for (const edit of edits) {
    result += bytes.subarray(previous, edit.at).toString() + edit.text;
    previous = edit.at;
  }
  result += bytes.subarray(previous).toString();
  return { source: result, entries, conditions };
}
