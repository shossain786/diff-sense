package com.razatech.diffsense.engine

private fun plural(n: Int, word: String) =
    "$n $word${if (n == 1) "" else if (Regex("(ch|s|x)$").containsMatchIn(word)) "es" else "s"}"

private fun impactLine(c: Change) =
    if (c.impact != null && c.impact != Impact.INFORMATIONAL) "\n  Impact: ${c.impact.id.uppercase()}" else ""

private fun line0(c: Change): String = when (c.kind) {
    ChangeKind.MODIFIED -> "⚠ ${c.path}\n  ${formatValue(c.before)} → ${formatValue(c.after)}"
    ChangeKind.ADDED -> "+ ${c.path}\n  ${formatValue(c.after)}"
    ChangeKind.REMOVED -> "- ${c.path}\n  ${formatValue(c.before)}"
    ChangeKind.UNCHANGED -> "✓ ${c.path}\n  unchanged"
}

private fun apiPath(p: String) = if (p.startsWith("body.")) p.substring(5) else p

private fun apiLine(c: Change): String {
    val p = apiPath(c.path)
    return when (c.kind) {
        ChangeKind.UNCHANGED -> "$p:\n  ${formatValue(c.before)} → ${formatValue(c.after)} ✓"
        ChangeKind.REMOVED -> "$p:\n  ${formatValue(c.before)} → (missing) ❌"
        ChangeKind.ADDED -> "$p:\n  (not expected) → ${formatValue(c.after)} ❌"
        ChangeKind.MODIFIED -> "$p:\n  ${formatValue(c.before)} → ${formatValue(c.after)} ❌"
    }
}

private fun join(lines: List<String>) = jsTrimEnd(lines.joinToString("\n")) + "\n"

/** PRD section 15 expected-vs-actual report. */
private fun renderApiReport(r: ComparisonResult): String {
    val bad = apiMismatches(r)
    val out = arrayListOf("DiffSense — API Response Comparison", "", "Expected: ${r.left}", "Actual:   ${r.right}", "")
    for (c in r.changes) { out.add(apiLine(c)); out.add("") }
    out.add(if (bad == 0) "Result: PASS — actual matches expected" else "Result: FAIL — ${plural(bad, "mismatch")}")
    for (w in r.warnings) out.add("Note: $w")
    return join(out)
}

/** Plain-text change summary. Unchanged entries are counted, not listed. */
fun renderSummary(r: ComparisonResult): String {
    if (r.format == Format.API) return renderApiReport(r)
    val (added, removed, modified, unchanged) = r.stats
    val total = added + removed + modified
    val out = arrayListOf("DiffSense — Change Summary", "", "Files:", r.left, r.right, "")
    if (total == 0) {
        out.add("No differences found.")
    } else {
        out.add("Changes:")
        if (added > 0) out.add("+ ${plural(added, "item")} added")
        if (removed > 0) out.add("- ${plural(removed, "item")} removed")
        if (modified > 0) out.add("⚠ ${plural(modified, "item")} modified")
        if (unchanged > 0) out.add("✓ $unchanged unchanged")
        out.add(""); out.add("Details:"); out.add("────────────────────────────")
        for (c in r.changes.filter { it.kind != ChangeKind.UNCHANGED }) { out.add(line0(c) + impactLine(c)); out.add("") }
    }
    if (r.impact != null) out.add("Potential impact (estimate): ${r.impact.id}")
    for (w in r.warnings) out.add("Note: $w")
    return join(out)
}

private fun mdCode(v: String) = "`" + v.replace("`", "'").replace("\n", " ") + "`"

/** Markdown change summary, suitable for export or pasting into a PR. */
fun renderMarkdown(r: ComparisonResult): String {
    if (r.format == Format.API) {
        val bad = apiMismatches(r)
        val out = arrayListOf(
            "# DiffSense — API Response Comparison",
            "",
            "**Expected:** ${mdCode(r.left)}  ",
            "**Actual:** ${mdCode(r.right)}",
            "",
            "**Result:** ${if (bad == 0) "PASS" else "FAIL (${plural(bad, "mismatch")})"}",
            "",
            "| Field | Expected | Actual | |",
            "|---|---|---|:-:|",
        )
        val cell = { v: Any? -> mdCode(formatValue(v)).replace("|", "\\|") }
        for (c in r.changes) {
            val exp = if (c.kind == ChangeKind.ADDED) "_(not expected)_" else cell(c.before)
            val act = if (c.kind == ChangeKind.REMOVED) "_(missing)_" else cell(c.after)
            out.add("| ${mdCode(apiPath(c.path))} | $exp | $act | ${if (c.kind == ChangeKind.UNCHANGED) "✓" else "❌"} |")
        }
        for (w in r.warnings) { out.add(""); out.add("> Note: $w") }
        return out.joinToString("\n") + "\n"
    }
    val (added, removed, modified, unchanged) = r.stats
    val out = arrayListOf(
        "# DiffSense — Change Summary",
        "",
        "**Files:** ${mdCode(r.left)} ↔ ${mdCode(r.right)}",
        "",
        "| Added | Removed | Modified | Unchanged |",
        "|---:|---:|---:|---:|",
        "| $added | $removed | $modified | $unchanged |",
        "",
    )
    val changed = r.changes.filter { it.kind != ChangeKind.UNCHANGED }
    if (changed.isEmpty()) { out.add("No differences found."); out.add("") }
    else {
        out.add("## Changes"); out.add("")
        for (c in changed) {
            when (c.kind) {
                ChangeKind.MODIFIED -> out.add("- ⚠ ${mdCode(c.path)}: ${mdCode(formatValue(c.before))} → ${mdCode(formatValue(c.after))}")
                ChangeKind.ADDED -> out.add("- + ${mdCode(c.path)}: ${mdCode(formatValue(c.after))}")
                else -> out.add("- − ${mdCode(c.path)}: ${mdCode(formatValue(c.before))}")
            }
        }
        out.add("")
    }
    if (r.impact != null) { out.add("**Potential impact (estimate):** ${r.impact.id}"); out.add("") }
    for (w in r.warnings) { out.add("> Note: $w"); out.add("") }
    return join(out)
}
