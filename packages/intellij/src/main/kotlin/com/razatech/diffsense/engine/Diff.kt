package com.razatech.diffsense.engine

/** Structural comparison of two already-parsed values (JSON, YAML and XML share it). */
@Suppress("UNCHECKED_CAST")
internal class Differ(private val o: CompareOptions) {
    private val ignores = compileGlobs(o.ignorePaths)

    fun diff(left: Any?, right: Any?): List<Change> {
        val out = ArrayList<Change>()
        walk(left, right, "", out)
        return out
    }

    private fun child(base: String, key: String) = if (base.isEmpty()) key else "$base.$key"

    private fun scalarEqual(a: Any?, b: Any?): Boolean {
        if (a is String && b is String) {
            var x: String = a
            var y: String = b
            if (o.ignoreWhitespace == true) {
                x = collapseWs(jsTrim(x))
                y = collapseWs(jsTrim(y))
            }
            if (o.ignoreCase == true) {
                x = x.lowercase()
                y = y.lowercase()
            }
            return x == y
        }
        if (o.numericEquality == true) {
            val x = num(a)
            val y = num(b)
            if (!x.isNaN() && !y.isNaN()) return x == y
        }
        return when {
            a == null || b == null -> a == null && b == null
            a is Number && b is Number -> numbersEqual(a, b)
            a is Boolean && b is Boolean -> a == b
            a is String && b is String -> a == b
            else -> false
        }
    }

    private fun num(v: Any?): Double = when {
        v is Number -> v.toDouble()
        v is String && jsTrim(v).isNotEmpty() -> jsToNumber(jsTrim(v))
        else -> Double.NaN
    }

    private fun hasChanges(a: Any?, b: Any?, path: String): Boolean {
        val tmp = ArrayList<Change>()
        walk(a, b, path, tmp)
        return tmp.any { it.kind != ChangeKind.UNCHANGED }
    }

    private fun walk(a: Any?, b: Any?, path: String, out: MutableList<Change>) {
        val p = if (path.isEmpty()) "$" else path
        if (path.isNotEmpty() && matchesAny(path, ignores)) return

        if (a is Map<*, *> && b is Map<*, *>) {
            val ma = a as Map<String, Any?>
            val mb = b as Map<String, Any?>
            val ka = orderedKeys(ma)
            val kb = orderedKeys(mb)
            for (k in ka) {
                val cp = child(path, k)
                if (matchesAny(cp, ignores)) continue
                if (mb.containsKey(k)) walk(ma[k], mb[k], cp, out)
                else out.add(Change(cp, ChangeKind.REMOVED, before = ma[k]))
            }
            for (k in kb) {
                val cp = child(path, k)
                if (!ma.containsKey(k) && !matchesAny(cp, ignores)) out.add(Change(cp, ChangeKind.ADDED, after = mb[k]))
            }
            if (o.ignoreOrdering == false) {
                val ca = ka.filter { mb.containsKey(it) }
                val cb = kb.filter { ma.containsKey(it) }
                if (ca.joinToString("\u0000") != cb.joinToString("\u0000")) {
                    out.add(Change(p, ChangeKind.MODIFIED, "key order: " + ca.joinToString(", "), "key order: " + cb.joinToString(", ")))
                }
            }
            return
        }

        if (a is List<*> && b is List<*>) {
            if (o.ignoreArrayOrder == true) return walkUnorderedArrays(a, b, path, out)
            val len = maxOf(a.size, b.size)
            for (i in 0 until len) {
                val cp = "$path[$i]"
                if (matchesAny(cp, ignores)) continue
                when {
                    i >= b.size -> out.add(Change(cp, ChangeKind.REMOVED, before = a[i]))
                    i >= a.size -> out.add(Change(cp, ChangeKind.ADDED, after = b[i]))
                    else -> walk(a[i], b[i], cp, out)
                }
            }
            return
        }

        // Scalars, or a type change (object vs array vs scalar).
        val composite = { v: Any? -> v is Map<*, *> || v is List<*> }
        if (!composite(a) && !composite(b) && scalarEqual(a, b)) {
            out.add(Change(p, ChangeKind.UNCHANGED, a, b))
        } else {
            out.add(Change(p, ChangeKind.MODIFIED, a, b))
        }
    }

    private fun walkUnorderedArrays(a: List<*>, b: List<*>, path: String, out: MutableList<Change>) {
        val usedB = HashSet<Int>()
        val unmatchedA = ArrayList<Int>()
        for (i in a.indices) {
            val cp = "$path[$i]"
            if (matchesAny(cp, ignores)) continue
            var found = -1
            for (j in b.indices) {
                if (j !in usedB && !hasChanges(a[i], b[j], cp)) { found = j; break }
            }
            if (found >= 0) {
                usedB.add(found)
                walk(a[i], b[found], cp, out)
            } else unmatchedA.add(i)
        }
        val unmatchedB = b.indices.filter { it !in usedB }
        val paired = minOf(unmatchedA.size, unmatchedB.size)
        for (k in 0 until paired) walk(a[unmatchedA[k]], b[unmatchedB[k]], "$path[${unmatchedA[k]}]", out)
        for (i in unmatchedA.drop(paired)) out.add(Change("$path[$i]", ChangeKind.REMOVED, before = a[i]))
        for (j in unmatchedB.drop(paired)) out.add(Change("$path[$j]", ChangeKind.ADDED, after = b[j]))
    }
}

internal fun diffValues(left: Any?, right: Any?, options: CompareOptions): List<Change> = Differ(options).diff(left, right)
