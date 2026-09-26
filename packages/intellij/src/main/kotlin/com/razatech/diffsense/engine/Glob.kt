package com.razatech.diffsense.engine

/**
 * Path globs for ignore rules. `*` matches within one path segment, `**` matches across segments.
 * Paths look like `a.b[0].c`.
 */
internal fun compileGlobs(globs: List<String>?): List<Regex> = (globs ?: emptyList()).map { g ->
    val src = g.split("**").joinToString(".*") { part ->
        part.split("*").joinToString("[^.\\[\\]]*") { escapeRegex(it) }
    }
    Regex("^$src$")
}

private fun escapeRegex(s: String): String = buildString {
    for (c in s) {
        if (c in ".+?^\${}()|[]\\") append('\\')
        append(c)
    }
}

internal fun matchesAny(path: String, globs: List<Regex>): Boolean = globs.any { it.matches(path) }
