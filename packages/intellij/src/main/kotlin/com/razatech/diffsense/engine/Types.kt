package com.razatech.diffsense.engine

/** Marks "no value" (JavaScript `undefined`), which is different from a JSON `null`. */
object Absent {
    override fun toString() = "<absent>"
}

enum class Format(val id: String) {
    TEXT("text"), JSON("json"), XML("xml"), YAML("yaml"), JAVA("java"), API("api");

    companion object {
        fun byId(id: String): Format? = entries.firstOrNull { it.id == id }
    }
}

enum class ChangeKind(val id: String) { ADDED("added"), REMOVED("removed"), MODIFIED("modified"), UNCHANGED("unchanged") }

/** Impact is an estimate, never a guarantee. */
enum class Impact(val id: String) {
    INFORMATIONAL("informational"), LOW("low"), MEDIUM("medium"), HIGH("high"), CRITICAL("critical");

    companion object {
        fun byId(id: String): Impact? = entries.firstOrNull { it.id == id }
    }
}

data class Change(
    /** Dotted/structural path, e.g. `user.age` or `servers[0].host`. */
    val path: String,
    val kind: ChangeKind,
    val before: Any? = Absent,
    val after: Any? = Absent,
    /** `fact` for observed differences, `inferred` for guesses about intent. */
    val evidence: String = "fact",
    val impact: Impact? = null,
    val reason: String? = null,
)

data class ChangeStats(val added: Int, val removed: Int, val modified: Int, val unchanged: Int)

data class FileInput(val name: String, val content: String)

/** Every field is nullable so "not set" can be layered: settings, then config file, then per-call overrides. */
data class CompareOptions(
    val format: Format? = null,
    val ignoreWhitespace: Boolean? = null,
    val ignoreCase: Boolean? = null,
    val ignoreOrdering: Boolean? = null,
    val ignoreArrayOrder: Boolean? = null,
    val ignorePaths: List<String>? = null,
    val numericEquality: Boolean? = null,
    val ignoreXmlDeclaration: Boolean? = null,
    val ignoreAttributes: List<String>? = null,
    val ignoreNamespaces: Boolean? = null,
    val ignoreExtraFields: Boolean? = null,
    val ignoreHeaders: List<String>? = null,
    val qaMode: Boolean? = null,
) {
    /** Values set on [other] win. */
    fun overlay(other: CompareOptions) = CompareOptions(
        other.format ?: format,
        other.ignoreWhitespace ?: ignoreWhitespace,
        other.ignoreCase ?: ignoreCase,
        other.ignoreOrdering ?: ignoreOrdering,
        other.ignoreArrayOrder ?: ignoreArrayOrder,
        other.ignorePaths ?: ignorePaths,
        other.numericEquality ?: numericEquality,
        other.ignoreXmlDeclaration ?: ignoreXmlDeclaration,
        other.ignoreAttributes ?: ignoreAttributes,
        other.ignoreNamespaces ?: ignoreNamespaces,
        other.ignoreExtraFields ?: ignoreExtraFields,
        other.ignoreHeaders ?: ignoreHeaders,
        other.qaMode ?: qaMode,
    )
}

data class ComparisonResult(
    val format: Format,
    val left: String,
    val right: String,
    val changes: List<Change>,
    val stats: ChangeStats,
    val impact: Impact?,
    /** Set when a structured parse failed and the text fallback was used. */
    val warnings: List<String>,
)

class ParseError(message: String) : Exception(message)

internal fun computeStats(changes: List<Change>): ChangeStats {
    var a = 0; var r = 0; var m = 0; var u = 0
    for (c in changes) when (c.kind) {
        ChangeKind.ADDED -> a++
        ChangeKind.REMOVED -> r++
        ChangeKind.MODIFIED -> m++
        ChangeKind.UNCHANGED -> u++
    }
    return ChangeStats(a, r, m, u)
}
