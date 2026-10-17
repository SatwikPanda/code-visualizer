package codeviz;

import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.lang.model.type.TypeKind;
import javax.tools.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Generates narrow boolean probes, with an original-code fallback for Java flow-sensitive constructs. */
final class Conditions {
    record Operand(long start, long end, Map<String,Object> definition) {}
    record Site(long start, long end, Map<String,Object> definition, boolean supported, List<Operand> operands) {}
    record Wrap(long start, long end, String prefix, int priority) {}

    static List<Site> collect(CompilationUnitTree unit, Trees trees, String source) {
        List<Site> sites = new ArrayList<>();
        new TreePathScanner<Void,Void>() {
            void add(String kind, ExpressionTree expression) {
                if (expression == null) return;
                long start = trees.getSourcePositions().getStartPosition(unit, expression);
                long end = trees.getSourcePositions().getEndPosition(unit, expression);
                if (start < 0 || end <= start || end > source.length()) return;
                boolean[] pattern = {false};
                new TreeScanner<Void,Void>() {
                    @Override public Void visitBindingPattern(BindingPatternTree tree, Void unused) {
                        pattern[0] = true;
                        return null;
                    }
                }.scan(expression, null);
                ExpressionTree unwrapped = expression;
                while (unwrapped instanceof ParenthesizedTree parens) unwrapped = parens.getExpression();
                boolean constantLoop = !kind.equals("if") && !kind.equals("ternary")
                    && unwrapped instanceof LiteralTree literal && literal.getValue() instanceof Boolean;
                String reason = pattern[0] ? "Java pattern-variable flow is preserved; this condition is not probed."
                    : constantLoop ? "Compile-time loop conditions are preserved; this condition is not probed." : null;
                long line = unit.getLineMap().getLineNumber(start);
                long endLine = unit.getLineMap().getLineNumber(end);
                String id = "c" + start + "_" + end;
                List<Operand> operands = new ArrayList<>();
                if (reason == null) new TreePathScanner<Void,Void>() {
                    void capture(ExpressionTree node) {
                        if (operands.size() >= 24) return;
                        var type = trees.getTypeMirror(getCurrentPath());
                        if (type == null || type.getKind() == TypeKind.VOID || type.getKind() == TypeKind.ERROR
                            || type.getKind() == TypeKind.NONE || type.getKind() == TypeKind.NULL) return;
                        long from = trees.getSourcePositions().getStartPosition(unit, node);
                        long to = trees.getSourcePositions().getEndPosition(unit, node);
                        if (from < start || to <= from || to > end) return;
                        operands.add(new Operand(from, to, Json.map("id", "o" + from + "_" + to,
                            "expression", source.substring((int)from, (int)to), "start", from - start, "end", to - start)));
                    }
                    @Override public Void visitIdentifier(IdentifierTree node, Void v) {
                        if (trees.getElement(getCurrentPath()) instanceof VariableElement) capture(node);
                        return null;
                    }
                    @Override public Void visitMemberSelect(MemberSelectTree node, Void v) {
                        if (trees.getElement(getCurrentPath()) instanceof VariableElement) capture(node);
                        return null;
                    }
                    @Override public Void visitMethodInvocation(MethodInvocationTree node, Void v) { capture(node); return null; }
                    @Override public Void visitArrayAccess(ArrayAccessTree node, Void v) { capture(node); return null; }
                    @Override public Void visitAssignment(AssignmentTree node, Void v) { capture(node); return null; }
                    @Override public Void visitCompoundAssignment(CompoundAssignmentTree node, Void v) { capture(node); return null; }
                    @Override public Void visitUnary(UnaryTree node, Void v) {
                        if (Set.of(Tree.Kind.POSTFIX_INCREMENT, Tree.Kind.PREFIX_INCREMENT, Tree.Kind.POSTFIX_DECREMENT, Tree.Kind.PREFIX_DECREMENT).contains(node.getKind())) {
                            capture(node); return null;
                        }
                        return super.visitUnary(node,v);
                    }
                    @Override public Void visitLambdaExpression(LambdaExpressionTree node, Void v) { return null; }
                    @Override public Void visitClass(ClassTree node, Void v) { return null; }
                }.scan(new TreePath(getCurrentPath(), expression), null);
                Map<String,Object> definition = Json.map(
                    "id", id, "kind", kind,
                    "expression", source.substring((int)start, (int)end),
                    "line", line, "column", start - unit.getLineMap().getStartPosition(line) + 1,
                    "endLine", endLine, "endColumn", end - unit.getLineMap().getStartPosition(endLine) + 1,
                    "recordable", reason == null, "reason", reason,
                    "operands", operands.stream().map(Operand::definition).toList());
                sites.add(new Site(start, end, definition, reason == null, operands));
            }
            @Override public Void visitIf(IfTree tree, Void v) { add("if", tree.getCondition()); return super.visitIf(tree,v); }
            @Override public Void visitWhileLoop(WhileLoopTree tree, Void v) { add("while", tree.getCondition()); return super.visitWhileLoop(tree,v); }
            @Override public Void visitDoWhileLoop(DoWhileLoopTree tree, Void v) { add("do-while", tree.getCondition()); return super.visitDoWhileLoop(tree,v); }
            @Override public Void visitForLoop(ForLoopTree tree, Void v) { add("for", tree.getCondition()); return super.visitForLoop(tree,v); }
            @Override public Void visitConditionalExpression(ConditionalExpressionTree tree, Void v) { add("ternary", tree.getCondition()); return super.visitConditionalExpression(tree,v); }
        }.scan(unit, null);
        return sites;
    }

    static List<Object> compile(Path job, String filename, String source, List<Site> sites) throws IOException {
        List<Site> supported = sites.stream().filter(Site::supported).toList();
        List<Object> definitions = new ArrayList<>(sites.stream().map(Site::definition).toList());
        if (supported.isEmpty()) return definitions;
        Map<Long,List<Wrap>> opens = new HashMap<>(), closes = new HashMap<>();
        List<Wrap> wraps = new ArrayList<>();
        for (Site site : supported) {
            String id = (String)site.definition().get("id");
            wraps.add(new Wrap(site.start(), site.end(), "(codeviz.Probe.condition(\"" + id + "\",codeviz.Probe.begin(\"" + id + "\"),", 0));
            for (Operand operand : site.operands()) wraps.add(new Wrap(operand.start(), operand.end(),
                "(codeviz.Probe.operand(\"" + id + "\",\"" + operand.definition().get("id") + "\",", 1));
        }
        for (Wrap wrap : wraps) {
            opens.computeIfAbsent(wrap.start(), x -> new ArrayList<>()).add(wrap);
            closes.computeIfAbsent(wrap.end(), x -> new ArrayList<>()).add(wrap);
        }
        StringBuilder instrumented = new StringBuilder();
        for (int i = 0; i <= source.length(); i++) {
            List<Wrap> ending = closes.get((long)i);
            if (ending != null) ending.stream().sorted(Comparator.<Wrap>comparingLong(s -> s.end() - s.start()).thenComparing(Comparator.comparingInt(Wrap::priority).reversed())).forEach(s -> instrumented.append("))"));
            List<Wrap> starting = opens.get((long)i);
            if (starting != null) starting.stream().sorted(Comparator.<Wrap>comparingLong(s -> s.end() - s.start()).reversed().thenComparingInt(Wrap::priority)).forEach(s -> instrumented.append(s.prefix()));
            if (i < source.length()) instrumented.append(source.charAt(i));
        }
        Path output = job.resolve("condition-classes");
        Files.createDirectories(output);
        boolean valid = false;
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(null,null,null)) {
            DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
            JavacTask task = (JavacTask)compiler.getTask(null,fm,diagnostics,
                List.of("-proc:none","-g:lines,vars,source","-parameters","-encoding","UTF-8",
                    "-classpath",System.getProperty("java.class.path"),"-d",output.toString()),null,
                List.of(new Analyzer.Source(filename.substring(0,filename.length()-5),instrumented.toString())));
            CompilationUnitTree unit = task.parse().iterator().next();
            task.analyze();
            Trees trees = Trees.instance(task);
            int[] verified = {0};
            boolean[] correctOwner = {true};
            new TreePathScanner<Void,Void>() {
                @Override public Void visitMethodInvocation(MethodInvocationTree call, Void unused) {
                    if (Set.of("codeviz.Probe.condition", "codeviz.Probe.begin", "codeviz.Probe.operand").contains(call.getMethodSelect().toString())) {
                        Element method = trees.getElement(getCurrentPath());
                        if (method instanceof ExecutableElement e && e.getEnclosingElement() instanceof TypeElement owner
                            && task.getElements().getBinaryName(owner).contentEquals("codeviz.Probe")) verified[0]++;
                        else correctOwner[0] = false;
                    }
                    return super.visitMethodInvocation(call,unused);
                }
            }.scan(unit,null);
            valid = correctOwner[0] && verified[0] == wraps.size() + supported.size()
                && diagnostics.getDiagnostics().stream().noneMatch(d -> d.getKind() == Diagnostic.Kind.ERROR);
            if (valid) task.generate();
        } catch (RuntimeException failure) {
            valid = false;
        }
        if (valid) {
            // The instrumented compilation succeeded independently. Preserve all original source lines.
            remove(job.resolve("classes"));
            Files.move(output, job.resolve("classes"));
        } else {
            // Definite assignment, constant reachability, or other flow-sensitive typing may reject a wrapper.
            // Original classes are untouched, so that program still runs with its original semantics.
            remove(output);
            for (Site site : supported) {
                site.definition().put("recordable", false);
                site.definition().put("reason", "Java flow-sensitive compilation requires the original condition; its result is unavailable.");
            }
        }
        return definitions;
    }

    static void remove(Path directory) throws IOException {
        if (!Files.exists(directory)) return;
        try (var files = Files.walk(directory)) {
            for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
        }
    }
}
