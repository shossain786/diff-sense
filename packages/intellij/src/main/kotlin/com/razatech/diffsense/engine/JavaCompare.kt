package com.razatech.diffsense.engine

import com.github.javaparser.JavaParser
import com.github.javaparser.ParserConfiguration
import com.github.javaparser.Position
import com.github.javaparser.ast.Node
import com.github.javaparser.ast.body.AnnotationDeclaration
import com.github.javaparser.ast.body.CallableDeclaration
import com.github.javaparser.ast.body.ConstructorDeclaration
import com.github.javaparser.ast.body.EnumDeclaration
import com.github.javaparser.ast.body.FieldDeclaration
import com.github.javaparser.ast.body.MethodDeclaration
import com.github.javaparser.ast.body.RecordDeclaration
import com.github.javaparser.ast.body.TypeDeclaration
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration

/*
 * Java semantic comparison (port of `java.ts`). The TypeScript engine is the reference: the shared
 * conformance suite keeps both identical, so text slicing and normalisation mirror it exactly.
 */

private class Fact(val base: String, val value: String, val show: String, val impact: Impact? = null, val reason: String? = null)

private class JMethod(
    val key: String,
    val name: String,
    val sig: String,
    val isPublic: Boolean,
    val annos: List<String>,
    val facts: List<Fact>,
)

private class JField(val name: String, val decl: String, val annos: List<String>)

private class JType(val qname: String, val header: String, val annos: List<String>, val isPublic: Boolean) {
    val fields = LinkedHashMap<String, JField>()
    val methods = LinkedHashMap<String, JMethod>()
}

private class JModel {
    var pkg: String? = null
    val imports = ArrayList<String>()
    val types = LinkedHashMap<String, JType>()
}

private class Tok(val image: String, val start: Int, val end: Int)

/** `s.replace(/\s+/g, ' ').trim()` with JavaScript's notion of whitespace. */
private fun norm(s: String) = collapseWs(s).trim { isJsSpace(it) }

private val IDENT = Regex("^[A-Za-z_$][\\w$]*$")
private val NOT_CALLS = setOf("if", "while", "for", "switch", "catch", "synchronized", "return", "throw", "new", "else", "do", "try", "assert")
private val LOGGING = Regex("^(log|logger|LOG|LOGGER|System\\.out|System\\.err)\\b|\\.(debug|info|trace|warn|println|printf|print)$")

/* ---------- Source positions ---------- */

private class Src(val text: String) {
    private val lineStarts: IntArray

    init {
        val starts = ArrayList<Int>()
        starts.add(0)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '\r') {
                if (i + 1 < text.length && text[i + 1] == '\n') i++
                starts.add(i + 1)
            } else if (c == '\n') starts.add(i + 1)
            i++
        }
        lineStarts = starts.toIntArray()
    }

    fun offset(p: Position): Int = lineStarts[(p.line - 1).coerceIn(0, lineStarts.size - 1)] + p.column - 1
    fun begin(n: Node): Int = offset(n.range.get().begin)
    fun endExcl(n: Node): Int = offset(n.range.get().end) + 1
    fun slice(a: Int, b: Int): String = norm(text.substring(a.coerceIn(0, text.length), b.coerceIn(0, text.length)))
    fun text(n: Node): String = slice(begin(n), endExcl(n))
}

/* ---------- Body facts ---------- */

private fun tokensOf(body: Node, src: Src): List<Tok> {
    val out = ArrayList<Tok>()
    val range = body.tokenRange.orElse(null) ?: return out
    for (t in range) {
        if (t.category.isWhitespaceOrComment) continue
        val r = t.range.orElse(null) ?: continue
        out.add(Tok(t.text, src.offset(r.begin), src.offset(r.end) + 1))
    }
    return out
}

private fun extractFacts(body: Node?, src: Src): List<Fact> {
    if (body == null) return emptyList()
    val T = tokensOf(body, src).sortedBy { it.start }
    val facts = ArrayList<Fact>()
    fun slice(a: Int, b: Int) = src.slice(a, b)
    fun img(i: Int): String? = T.getOrNull(i)?.image

    fun closeOf(open: Int): Int {
        var depth = 0
        for (j in open until T.size) {
            if (T[j].image == "(") depth++
            else if (T[j].image == ")" && --depth == 0) return j
        }
        return -1
    }

    // index of the token ending an expression that starts at `from`
    fun exprEnd(from: Int): Int {
        var depth = 0
        for (j in from until T.size) {
            val t = T[j].image
            if (t == "(" || t == "[" || t == "{") depth++
            else if (t == ")" || t == "]" || t == "}") {
                if (depth == 0) return j - 1
                depth--
            } else if (depth == 0 && (t == ";" || t == ",")) return j - 1
        }
        return T.size - 1
    }

    // `new Foo<T>(..) { ... }`: the class body is part of the enclosing call's arguments, so its inner
    // methods, returns and calls are not separate changes of the surrounding method.
    val anonBodies = ArrayList<IntRange>()
    for (i in T.indices) {
        if (T[i].image != "new") continue
        var j = i + 1
        var angle = 0
        while (j < T.size) {
            val im = T[j].image
            if (im == "<") angle++
            else if (im == ">") angle--
            else if (im == ">>") angle -= 2
            else if (angle == 0 && im == "(") break
            else if (angle == 0 && !IDENT.matches(im) && im != ".") {
                j = T.size
                break
            }
            j++
        }
        if (j >= T.size) continue
        val c = closeOf(j)
        if (c < 0 || img(c + 1) != "{") continue
        var depth = 0
        for (k in c + 1 until T.size) {
            if (T[k].image == "{") depth++
            else if (T[k].image == "}" && --depth == 0) {
                anonBodies.add((c + 1)..k)
                break
            }
        }
    }

    for (i in T.indices) {
        if (anonBodies.any { i in it }) continue
        val t = T[i].image
        val next = img(i + 1)

        if ((t == "if" || t == "while" || t == "for" || t == "switch" || t == "catch") && next == "(") {
            val c = closeOf(i + 1)
            if (c < 0) continue
            val inner = slice(T[i + 1].end, T[c].start)
            val isCatch = t == "catch"
            facts.add(
                Fact(
                    if (isCatch) "catch" else t, inner, "$t ($inner)", Impact.MEDIUM,
                    if (isCatch) "Exception handling changed." else "Control-flow condition changed; behaviour may differ.",
                ),
            )
        } else if (t == "throw") {
            val e = exprEnd(i + 1)
            val v = slice(T[i + 1].start, T[maxOf(e, i + 1)].end)
            facts.add(Fact("throw", v, "throw $v", Impact.MEDIUM, "Exception handling changed."))
        } else if (t == "finally") {
            facts.add(Fact("finally", "", "finally", Impact.MEDIUM, "Exception handling changed."))
        } else if (t == "return" && next != ";") {
            val e = exprEnd(i + 1)
            val v = slice(T[i + 1].start, T[maxOf(e, i + 1)].end)
            facts.add(Fact("return", v, "return $v", Impact.MEDIUM, "Returned value changed."))
        } else if (IDENT.matches(t) && t !in NOT_CALLS && next == "(") {
            val c = closeOf(i + 1)
            if (c < 0) continue
            val args = slice(T[i + 1].end, T[c].start)
            var callee = t
            if (img(i - 1) == "new") callee = "new $t"
            else {
                var j = i
                while (img(j - 1) == "." && IDENT.matches(img(j - 2) ?: "")) {
                    callee = "${T[j - 2].image}.$callee"
                    j -= 2
                }
                if (img(j - 1) == "." && img(j - 2) == ")") callee = ".$callee"
            }
            val logging = LOGGING.containsMatchIn(callee)
            facts.add(
                Fact(
                    "call $callee", args, "$callee($args)",
                    if (logging) Impact.LOW else Impact.MEDIUM,
                    if (logging) "Logging/output call changed." else "Method call changed; behaviour may differ.",
                ),
            )
        } else if (t == "=" && IDENT.matches(img(i - 1) ?: "")) {
            var lhs = T[i - 1].image
            var j = i - 1
            while (img(j - 1) == "." && IDENT.matches(img(j - 2) ?: "")) {
                lhs = "${T[j - 2].image}.$lhs"
                j -= 2
            }
            val e = exprEnd(i + 1)
            if (e >= i + 1) {
                val v = slice(T[i + 1].start, T[e].end)
                // impact left unset: keyword rules classify by variable name
                facts.add(Fact("assign $lhs", v, "$lhs = $v"))
            }
        }
    }
    return facts
}

/* ---------- Model building ---------- */

private fun parse(input: FileInput): com.github.javaparser.ast.CompilationUnit {
    val config = ParserConfiguration()
        .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)
        .setAttributeComments(false)
        .setTabSize(1)
    val result = JavaParser(config).parse(input.content)
    val cu = result.result.orElse(null)
    if (!result.isSuccessful || cu == null) {
        val msg = result.problems.firstOrNull()?.message?.lineSequence()?.firstOrNull() ?: "syntax error"
        throw ParseError("${input.name}: $msg")
    }
    return cu
}

/** End offset of the last modifier/annotation, or the node's own start when there are none. */
private fun afterModifiers(n: Node, mods: List<Node>, annos: List<Node>, src: Src): Int =
    (mods + annos).maxOfOrNull { src.endExcl(it) } ?: src.begin(n)

private class ModelBuilder(input: FileInput) {
    private val cu = parse(input)
    private val src = Src(input.content)
    val model = JModel()

    fun build(): JModel {
        cu.packageDeclaration.ifPresent {
            model.pkg = src.text(it).replace(Regex("^package\\s+"), "").replace(Regex(";$"), "").trim()
        }
        for (imp in cu.imports) {
            model.imports.add(src.text(imp).replace(Regex("^import\\s+"), "").replace(Regex(";$"), "").trim())
        }
        for (td in cu.types) visitType(td, null)
        return model
    }

    private fun addMethod(d: CallableDeclaration<*>, t: JType) {
        val isCtor = d is ConstructorDeclaration
        val mods = d.modifiers.map { src.text(it) }
        val annos = d.annotations.map { src.text(it) }
        val name = d.nameAsString
        val types = d.parameters.map { p ->
            src.text(p.type).replace(Regex("\\s+"), "") + if (p.isVarArgs) "..." else ""
        }
        val key = "${if (isCtor) "<init>" else name}(${types.joinToString(",")})"
        val params = d.parameters
        val plist = if (params.isEmpty()) "" else src.slice(src.begin(params.first()), src.endExcl(params.last()))

        var typeParams = ""
        var result = ""
        if (d is MethodDeclaration) {
            val tps = d.typeParameters
            if (tps.isNotEmpty()) {
                var a = src.begin(tps.first())
                while (a > 0 && src.text[a - 1].isWhitespace()) a--
                if (a > 0 && src.text[a - 1] == '<') a--
                var b = src.endExcl(tps.last())
                while (b < src.text.length && src.text[b].isWhitespace()) b++
                if (b < src.text.length && src.text[b] == '>') b++
                typeParams = src.slice(a, b)
            }
            result = src.text(d.type)
        }
        var thr = ""
        val thrown = d.thrownExceptions
        if (thrown.isNotEmpty()) {
            var a = src.begin(thrown.first())
            while (a > 0 && src.text[a - 1].isWhitespace()) a--
            a = (a - "throws".length).coerceAtLeast(0)
            thr = src.slice(a, src.endExcl(thrown.last()))
        }
        val sig = norm(listOf(mods.joinToString(" "), typeParams, result, "$name($plist)", thr).joinToString(" "))
        val body: Node? = when (d) {
            is MethodDeclaration -> d.body.orElse(null)
            is ConstructorDeclaration -> d.body
            else -> null
        }
        t.methods[key] = JMethod(
            key, name, sig,
            "public" in mods || "protected" in mods || (t.header.startsWith("interface") && "private" !in mods),
            annos, extractFacts(body, src),
        )
    }

    private fun addFields(d: FieldDeclaration, t: JType) {
        val mods = d.modifiers.map { src.text(it) }
        val annos = d.annotations.map { src.text(it) }
        val first = d.variables.firstOrNull() ?: return
        val typeStart = afterModifiers(d, d.modifiers, d.annotations, src)
        val typeText = src.slice(typeStart, src.begin(first.name))
        for (v in d.variables) {
            val init = v.initializer.orElse(null)
            val name = if (init != null) {
                src.slice(src.begin(v.name), src.begin(init)).trimEnd { it == '=' || isJsSpace(it) }
            } else src.slice(src.begin(v.name), src.endExcl(v))
            val initText = init?.let { src.text(it) }
            t.fields[v.nameAsString] = JField(
                v.nameAsString,
                norm("${mods.joinToString(" ")} $typeText $name${if (initText != null) " = $initText" else ""}"),
                annos,
            )
        }
    }

    private fun visitType(d: TypeDeclaration<*>, cur: JType?) {
        val name = d.nameAsString
        val qname = if (cur != null) "${cur.qname}.$name" else name
        val mods = d.modifiers.map { src.text(it) }
        val annos = d.annotations.map { src.text(it) }
        val keywordStart = afterModifiers(d, d.modifiers, d.annotations, src)
        // the header runs from the kind keyword to the `{` that opens the body
        val headerParts = ArrayList<Node>()
        headerParts.add(d.name)
        when (d) {
            is ClassOrInterfaceDeclaration -> {
                headerParts.addAll(d.typeParameters); headerParts.addAll(d.extendedTypes)
                headerParts.addAll(d.implementedTypes); headerParts.addAll(d.permittedTypes)
            }
            is EnumDeclaration -> headerParts.addAll(d.implementedTypes)
            is RecordDeclaration -> {
                headerParts.addAll(d.typeParameters); headerParts.addAll(d.parameters); headerParts.addAll(d.implementedTypes)
            }
            else -> {}
        }
        var scan = headerParts.maxOf { src.endExcl(it) }
        while (scan < src.text.length && src.text[scan] != '{') scan++
        val header = "${mods.joinToString(" ")} ${src.slice(keywordStart, scan)}".trim()
        val t = JType(qname, header, annos, "public" in mods)
        model.types[qname] = t

        if (d is EnumDeclaration) {
            for (e in d.entries) t.fields[e.nameAsString] = JField(e.nameAsString, "enum constant ${src.text(e)}", emptyList())
        }
        for (m in d.members) {
            when (m) {
                is TypeDeclaration<*> -> visitType(m, t)
                is MethodDeclaration -> addMethod(m, t)
                is ConstructorDeclaration -> addMethod(m, t)
                is FieldDeclaration -> addFields(m, t)
                else -> {}
            }
        }
    }
}

private fun buildModel(input: FileInput): JModel = ModelBuilder(input).build()

/* ---------- Diff ---------- */

private val ANNO_NAME = Regex("^@\\s*([\\w.$]+)")
private fun annoName(a: String) = ANNO_NAME.find(a)?.groupValues?.get(1) ?: a

private fun fact(path: String, kind: ChangeKind, before: String? = null, after: String? = null, impact: Impact? = null, reason: String? = null) =
    Change(path, kind, before ?: Absent, after ?: Absent, "fact", impact, reason)

private fun diffAnnotations(path: String, l: List<String>, r: List<String>, out: MutableList<Change>) {
    val lm = LinkedHashMap<String, String>().apply { l.forEach { put(annoName(it), it) } }
    val rm = LinkedHashMap<String, String>().apply { r.forEach { put(annoName(it), it) } }
    for ((n, a) in lm) {
        val b = rm[n]
        if (b == null) {
            out.add(fact("$path › @$n", ChangeKind.REMOVED, before = a, impact = Impact.MEDIUM, reason = "Annotation removed; framework behaviour may change."))
        } else if (a != b) {
            out.add(fact("$path › @$n", ChangeKind.MODIFIED, before = a, after = b, impact = Impact.MEDIUM, reason = "Annotation arguments changed."))
        }
    }
    for ((n, b) in rm) {
        if (n !in lm) out.add(fact("$path › @$n", ChangeKind.ADDED, after = b, impact = Impact.LOW, reason = "Annotation added."))
    }
}

private fun diffFacts(path: String, l: List<Fact>, r: List<Fact>, out: MutableList<Change>) {
    val bases = ArrayList<String>()
    for (f in l + r) if (f.base !in bases) bases.add(f.base)
    for (base in bases) {
        val L = l.filter { it.base == base }.toMutableList()
        val R = r.filter { it.base == base }.toMutableList()
        for (i in L.indices.reversed()) {
            val j = R.indexOfFirst { it.value == L[i].value }
            if (j >= 0) {
                L.removeAt(i)
                R.removeAt(j)
            }
        }
        val paired = minOf(L.size, R.size)
        val p = "$path › $base"
        fun meta(f: Fact, kind: ChangeKind, before: String?, after: String?): Change {
            val impact = f.impact
            return fact(p, kind, before, after, impact, if (impact != null) f.reason else null)
        }
        for (k in 0 until paired) out.add(meta(R[k], ChangeKind.MODIFIED, L[k].show, R[k].show))
        for (f in L.drop(paired)) out.add(meta(f, ChangeKind.REMOVED, f.show, null))
        for (f in R.drop(paired)) out.add(meta(f, ChangeKind.ADDED, null, f.show))
    }
}

private fun diffMethod(path: String, a: JMethod, b: JMethod, out: MutableList<Change>) {
    val before = out.size
    if (a.sig != b.sig) {
        out.add(
            fact(
                path, ChangeKind.MODIFIED, a.sig, b.sig,
                if (b.isPublic || a.isPublic) Impact.HIGH else Impact.MEDIUM,
                "Method signature changed; callers may be affected.",
            ),
        )
    }
    diffAnnotations(path, a.annos, b.annos, out)
    diffFacts(path, a.facts, b.facts, out)
    if (out.size == before) out.add(fact(path, ChangeKind.UNCHANGED, a.sig, b.sig))
}

private val VERSION_SEGMENT = Regex("\\.v\\d+(?=\\.)")
private val VERSION_OF = Regex("\\.(v\\d+)(?=\\.)")

private fun diffModels(a: JModel, b: JModel): MutableList<Change> {
    val out = ArrayList<Change>()
    if (a.pkg != b.pkg) {
        out.add(
            Change(
                "package", ChangeKind.MODIFIED, a.pkg ?: Absent, b.pkg ?: Absent, "fact", Impact.HIGH,
                "Package changed; all references to this class are affected.",
            ),
        )
    }
    val goneImports = a.imports.filter { it !in b.imports }.toMutableList()
    val newImports = b.imports.filter { it !in a.imports }.toMutableList()
    // A library version bump renames many imports at once (`.v138.` -> `.v147.`); report it once.
    fun versionKey(i: String) = i.replace(VERSION_SEGMENT, ".v*")
    fun versionOf(i: String) = VERSION_OF.find(i)?.groupValues?.get(1)
    val bumps = LinkedHashMap<String, Int>()
    for (old in goneImports.toList()) {
        val k = versionKey(old)
        val match = if (k != old) newImports.firstOrNull { versionKey(it) == k && it != old } else null
        if (match == null) continue
        goneImports.remove(old)
        newImports.remove(match)
        val step = "${versionOf(old)} → ${versionOf(match)}"
        bumps[step] = (bumps[step] ?: 0) + 1
    }
    for ((step, n) in bumps) {
        val (from, to) = step.split(" → ")
        out.add(
            fact(
                "imports › version bump", ChangeKind.MODIFIED, from, to, Impact.LOW,
                "$n import${if (n == 1) "" else "s"} moved to a different library version ($step); check for API changes.",
            ),
        )
    }
    for (i in goneImports) out.add(fact("imports › $i", ChangeKind.REMOVED, before = i, impact = Impact.INFORMATIONAL, reason = "Import removed."))
    for (i in newImports) out.add(fact("imports › $i", ChangeKind.ADDED, after = i, impact = Impact.INFORMATIONAL, reason = "Import added."))

    for ((q, ta) in a.types) {
        val tb = b.types[q]
        if (tb == null) {
            out.add(fact(q, ChangeKind.REMOVED, before = ta.header, impact = if (ta.isPublic) Impact.HIGH else Impact.MEDIUM, reason = "Type removed; dependants may break."))
            continue
        }
        val start = out.size
        if (ta.header != tb.header) {
            out.add(fact(q, ChangeKind.MODIFIED, ta.header, tb.header, Impact.HIGH, "Type declaration (modifiers, supertypes or kind) changed."))
        }
        diffAnnotations(q, ta.annos, tb.annos, out)

        for ((n, fa) in ta.fields) {
            val fb = tb.fields[n]
            val p = "$q.$n"
            if (fb == null) out.add(fact(p, ChangeKind.REMOVED, before = fa.decl, impact = Impact.MEDIUM, reason = "Field removed."))
            else if (fa.decl != fb.decl) out.add(fact(p, ChangeKind.MODIFIED, fa.decl, fb.decl))
            else out.add(fact(p, ChangeKind.UNCHANGED, fa.decl, fb.decl))
            if (fb != null) diffAnnotations(p, fa.annos, fb.annos, out)
        }
        for ((n, fb) in tb.fields) {
            if (n !in ta.fields) out.add(fact("$q.$n", ChangeKind.ADDED, after = fb.decl, impact = Impact.LOW, reason = "Field added."))
        }

        // Methods: match by name+parameter types, then pair leftovers by name (signature change).
        val remA = ta.methods.values.filter { it.key !in tb.methods }
        val remB = tb.methods.values.filter { it.key !in ta.methods }.toMutableList()
        for ((k, ma) in ta.methods) {
            val mb = tb.methods[k]
            if (mb != null) diffMethod("$q.$k", ma, mb, out)
        }
        for (ma in remA) {
            val idx = remB.indexOfFirst { it.name == ma.name }
            if (idx >= 0) {
                val mb = remB.removeAt(idx)
                diffMethod("$q.${mb.key}", ma, mb, out)
            } else {
                out.add(fact("$q.${ma.key}", ChangeKind.REMOVED, before = ma.sig, impact = if (ma.isPublic) Impact.HIGH else Impact.MEDIUM, reason = "Method removed; callers may break."))
            }
        }
        for (mb in remB) {
            out.add(fact("$q.${mb.key}", ChangeKind.ADDED, after = mb.sig, impact = Impact.LOW, reason = "Method added."))
        }
        if (out.size == start) out.add(fact(q, ChangeKind.UNCHANGED, ta.header, tb.header))
    }
    for ((q, tb) in b.types) {
        if (q !in a.types) out.add(fact(q, ChangeKind.ADDED, after = tb.header, impact = Impact.LOW, reason = "Type added."))
    }
    return out
}

/** "Assertion unchanged" style entries: a QA concern present on both sides that did not change. */
private fun qaUnchanged(a: JModel, b: JModel, changes: List<Change>): List<Change> {
    val out = ArrayList<Change>()
    for ((q, ta) in a.types) {
        val tb = b.types[q] ?: continue
        for ((key, ma) in ta.methods) {
            val mb = tb.methods[key] ?: continue
            for (cat in QaCategory.entries) {
                fun shows(m: JMethod) = m.facts
                    .filter { it.base.startsWith("call ") && categoryOf(it.base.substring(5)) == cat }
                    .map { it.show }
                    .sorted()
                val l = shows(ma)
                val r = shows(mb)
                val path = "$q.$key › ${cat.label}"
                if (l.isNotEmpty() && l.joinToString("\n") == r.joinToString("\n") && changes.none { it.path == path }) {
                    out.add(fact(path, ChangeKind.UNCHANGED, l.joinToString("; "), r.joinToString("; ")))
                }
            }
        }
    }
    return out
}

internal fun compareJava(left: FileInput, right: FileInput, options: CompareOptions): ComparisonResult {
    val a = buildModel(left)
    val b = buildModel(right)
    var changes: List<Change> = diffModels(a, b)
    val qa = options.qaMode ?: looksLikeTest(a.imports + b.imports)
    if (qa) changes = applyQaPack(changes) + qaUnchanged(a, b, changes)
    if (!options.ignorePaths.isNullOrEmpty()) {
        val ig = compileGlobs(options.ignorePaths)
        changes = changes.filter { !matchesAny(it.path, ig) }
    }
    return ComparisonResult(Format.JAVA, left.name, right.name, changes, computeStats(changes), null, emptyList())
}
