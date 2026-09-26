package com.razatech.diffsense.engine

/** Give up aligning past this many edits (memory grows with edits squared). */
private const val MAX_EDITS = 6000

private enum class T { EQ, DEL, ADD }
private class Edit(val t: T, val i: Int, val j: Int)
private class Op(val t: T, val line: String, val l: Int, val r: Int)

private fun normalizer(o: CompareOptions): (String) -> String = { line ->
    var s = if (line.endsWith("\r")) line.dropLast(1) else line
    if (o.ignoreWhitespace == true) s = collapseWs(jsTrim(s))
    if (o.ignoreCase == true) s = s.lowercase()
    s
}

private fun splitLines(content: String): List<String> {
    if (content.isEmpty()) return emptyList()
    val lines = content.split("\n").toMutableList()
    if (lines.last().isEmpty()) lines.removeAt(lines.size - 1)
    return lines
}

/**
 * Myers O(ND) shortest edit script. Returns null when the edit distance exceeds [MAX_EDITS].
 * Tie-breaking matches the TypeScript engine so both report the same lines.
 */
private fun myers(a: List<String>, b: List<String>): List<Edit>? {
    val n = a.size
    val m = b.size
    if (n == 0 && m == 0) return emptyList()
    val max = minOf(n + m, MAX_EDITS)
    val off = max + 1
    val v = IntArray(2 * max + 3)
    val trace = ArrayList<IntArray>()
    var found = -1
    var d = 0
    while (d <= max && found < 0) {
        trace.add(v.copyOfRange(off - d - 1, off + d + 2))
        var k = -d
        while (k <= d) {
            var x = if (k == -d || (k != d && v[off + k - 1] < v[off + k + 1])) v[off + k + 1] else v[off + k - 1] + 1
            var y = x - k
            while (x < n && y < m && a[x] == b[y]) { x++; y++ }
            v[off + k] = x
            if (x >= n && y >= m) { found = d; break }
            k += 2
        }
        d++
    }
    if (found < 0) return null

    val ops = ArrayList<Edit>()
    var x = n
    var y = m
    for (dd in found downTo 1) {
        val t = trace[dd]
        fun at(k: Int) = t[k + dd + 1]
        val k = x - y
        val prevK = if (k == -dd || (k != dd && at(k - 1) < at(k + 1))) k + 1 else k - 1
        val prevX = at(prevK)
        val prevY = prevX - prevK
        while (x > prevX && y > prevY) { x--; y--; ops.add(Edit(T.EQ, x, y)) }
        if (x == prevX) { y--; ops.add(Edit(T.ADD, x, y)) } else { x--; ops.add(Edit(T.DEL, x, y)) }
    }
    while (x > 0 && y > 0) { x--; y--; ops.add(Edit(T.EQ, x, y)) }
    ops.reverse()
    return ops
}

/** Line-level diff. The path of a change is `L<n>` (1-based line number). */
internal fun compareText(
    left: FileInput,
    right: FileInput,
    options: CompareOptions,
    format: Format = Format.TEXT,
    initialWarnings: List<String> = emptyList(),
): ComparisonResult {
    val warnings = initialWarnings.toMutableList()
    val norm = normalizer(options)
    val a = splitLines(left.content)
    val b = splitLines(right.content)
    val na = a.map(norm)
    val nb = b.map(norm)

    var start = 0
    while (start < na.size && start < nb.size && na[start] == nb[start]) start++
    var endA = na.size
    var endB = nb.size
    while (endA > start && endB > start && na[endA - 1] == nb[endB - 1]) { endA--; endB-- }

    val ops = ArrayList<Op>()
    for (i in 0 until start) ops.add(Op(T.EQ, a[i], i + 1, i + 1))

    val mid = myers(na.subList(start, endA), nb.subList(start, endB))
    if (mid == null) {
        warnings.add("Files differ too much for line alignment; middle section reported as replaced")
        for (i in start until endA) ops.add(Op(T.DEL, a[i], i + 1, 0))
        for (j in start until endB) ops.add(Op(T.ADD, b[j], 0, j + 1))
    } else {
        for (e in mid) when (e.t) {
            T.EQ -> ops.add(Op(T.EQ, a[start + e.i], start + e.i + 1, start + e.j + 1))
            T.DEL -> ops.add(Op(T.DEL, a[start + e.i], start + e.i + 1, 0))
            T.ADD -> ops.add(Op(T.ADD, b[start + e.j], 0, start + e.j + 1))
        }
    }
    var k = 0
    while (endA + k < na.size) {
        ops.add(Op(T.EQ, a[endA + k], endA + k + 1, endB + k + 1))
        k++
    }

    // Pair adjacent removed/added runs into "modified" lines.
    val changes = ArrayList<Change>()
    var unchanged = 0
    var p = 0
    while (p < ops.size) {
        if (ops[p].t == T.EQ) { unchanged++; p++; continue }
        val dels = ArrayList<Op>()
        val adds = ArrayList<Op>()
        while (p < ops.size && ops[p].t != T.EQ) {
            (if (ops[p].t == T.DEL) dels else adds).add(ops[p])
            p++
        }
        val paired = minOf(dels.size, adds.size)
        for (q in 0 until paired) {
            changes.add(Change("L${dels[q].l}", ChangeKind.MODIFIED, dels[q].line, adds[q].line))
        }
        for (d in dels.drop(paired)) changes.add(Change("L${d.l}", ChangeKind.REMOVED, before = d.line))
        for (x in adds.drop(paired)) changes.add(Change("L${x.r}", ChangeKind.ADDED, after = x.line))
    }

    return ComparisonResult(
        format, left.name, right.name, changes,
        computeStats(changes).copy(unchanged = unchanged), null, warnings,
    )
}
