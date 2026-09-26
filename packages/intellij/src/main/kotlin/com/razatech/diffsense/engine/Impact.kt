package com.razatech.diffsense.engine

private class Rule(val re: Regex, val impact: Impact, val reason: String)

/**
 * Keyword rules on the change path. First match wins, so the most severe rules come first. These are
 * heuristics: results are estimates only.
 */
private val RULES = listOf(
    Rule(
        Regex("(password|passwd|secret|token|api[-_]?key|private[-_]?key|credential)"),
        Impact.CRITICAL,
        "Name suggests credentials or secrets; a change may break authentication or expose access.",
    ),
    Rule(
        Regex("(url|uri|endpoint|host|domain|port|jdbc|database|db[-_]?name|connection|auth|permission|role|scope|encrypt|ssl|tls|cert)"),
        Impact.HIGH,
        "Name suggests a connection target or security setting; requests may reach a different service or be handled differently.",
    ),
    Rule(
        Regex("(timeout|retry|retries|limit|max|min|threshold|delay|wait|interval|ttl|expir|cache|enabled|disabled|feature|flag|mode|version|size|count|batch|pool|thread)"),
        Impact.MEDIUM,
        "Name suggests a behaviour or tuning setting; runtime behaviour may differ.",
    ),
)

private val FALLBACK = Rule(
    Regex("$^"), Impact.LOW,
    "No known behaviour-related name; likely a data or descriptive value.",
)

internal fun maxImpact(a: Impact, b: Impact): Impact = if (a.ordinal >= b.ordinal) a else b

/** Estimate the impact of a single structural (JSON/YAML/XML) change. */
internal fun classifyChange(change: Change): Change {
    if (change.kind == ChangeKind.UNCHANGED || change.impact != null) return change
    val path = change.path.lowercase()
    val rule = RULES.firstOrNull { it.re.containsMatchIn(path) } ?: FALLBACK
    return change.copy(impact = rule.impact, reason = rule.reason)
}

/**
 * Fills in impact/reason on every change that lacks one and sets the overall estimate. Free text has no
 * structure to reason about, and API comparisons are pass/fail against an expectation, so both are left alone.
 */
internal fun applyImpact(result: ComparisonResult): ComparisonResult {
    if (result.format == Format.TEXT || result.format == Format.API) return result
    val changes = result.changes.map { classifyChange(it) }
    val impact = changes.filter { it.kind != ChangeKind.UNCHANGED }
        .mapNotNull { it.impact }
        .reduceOrNull { acc, i -> maxImpact(acc, i) }
    return result.copy(changes = changes, impact = impact)
}
