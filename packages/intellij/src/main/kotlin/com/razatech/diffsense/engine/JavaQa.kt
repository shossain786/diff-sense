package com.razatech.diffsense.engine

/**
 * QA / test-automation rule pack for Java changes (port of `qa.ts`).
 *
 * Works on the changes the Java analyzer already produced. Raw call changes that belong to a QA concern
 * (locators, waits, assertions) are replaced by one semantic change each. Observed facts stay `fact`; the
 * Page Object heuristic is the only `inferred` result and says so.
 */
internal enum class QaCategory(val label: String) {
    LOCATOR("locator"), WAIT("wait strategy"), ASSERTION("assertion"),
}

private val LOCATOR = Regex("^By\\.\\w+$|\\.(findElements?)$|^new (?:By\\.\\w+)$")
private val WAIT = Regex(
    "(^|\\.)(sleep|implicitlyWait|pageLoadTimeout|setScriptTimeout|pollingEvery|withTimeout|ignoring)$|^Duration\\.of\\w+$|^new WebDriverWait$|^new FluentWait$|^TimeUnit\\.\\w+\\.sleep$",
)
private val ASSERTION = Regex(
    "^(Assert|Assertions|Assumptions)\\.\\w+$|^assert\\w+$|^assertThat$|^verify\\w*$|^expect$|^\\.(isEqualTo|isNotEqualTo|isTrue|isFalse|isNull|isNotNull|hasSize|contains|containsExactly|isEmpty|isNotEmpty|shouldBe|shouldHave)$",
)
private val TEST_ANNOTATION = Regex(
    "^(Test|Ignore|Disabled|Before|After|BeforeEach|AfterEach|BeforeAll|AfterAll|BeforeClass|AfterClass|BeforeMethod|AfterMethod|BeforeSuite|AfterSuite|ParameterizedTest|RepeatedTest|DataProvider|Given|When|Then)$",
)
private val DISABLING = Regex("^(Ignore|Disabled)$")
private val CALL = Regex(" › call (.+)$")
private val ANNO = Regex(" › @([\\w.$]+)$")
private val FIND_BY = Regex("^(FindBy|FindAll|FindBys)$")

internal fun categoryOf(callee: String): QaCategory? = when {
    ASSERTION.containsMatchIn(callee) -> QaCategory.ASSERTION
    LOCATOR.containsMatchIn(callee) -> QaCategory.LOCATOR
    WAIT.containsMatchIn(callee) -> QaCategory.WAIT
    else -> null
}

private val TEST_IMPORT = Regex(
    "^(org\\.openqa\\.selenium|org\\.junit|org\\.testng|io\\.cucumber|com\\.microsoft\\.playwright|io\\.restassured|org\\.assertj)\\b",
)

/** Imports that make a Java file look like an automated test. */
internal fun looksLikeTest(imports: List<String>): Boolean = imports.any { TEST_IMPORT.containsMatchIn(it) }

private class QaItem(val idx: Int, val callee: String, val change: Change)

private class Semantic(val modified: String, val removed: String, val added: String, val impact: Map<ChangeKind, Impact>)

private val SEMANTIC = mapOf(
    QaCategory.LOCATOR to Semantic(
        "Locator changed; element lookup may behave differently and test stability may be affected.",
        "Locator no longer appears in this method; it may have moved elsewhere (for example into a page object).",
        "Locator added.",
        mapOf(ChangeKind.MODIFIED to Impact.MEDIUM, ChangeKind.REMOVED to Impact.MEDIUM, ChangeKind.ADDED to Impact.LOW),
    ),
    QaCategory.WAIT to Semantic(
        "Wait strategy or duration changed; timing and test stability may be affected.",
        "Wait removed; the test may become flaky if the page is not ready.",
        "Wait added; the test may run slower or become more stable.",
        mapOf(ChangeKind.MODIFIED to Impact.MEDIUM, ChangeKind.REMOVED to Impact.MEDIUM, ChangeKind.ADDED to Impact.LOW),
    ),
    QaCategory.ASSERTION to Semantic(
        "Assertion changed; the test now checks a different outcome.",
        "Assertion removed; the test may no longer verify this behaviour.",
        "Assertion added.",
        mapOf(ChangeKind.MODIFIED to Impact.HIGH, ChangeKind.REMOVED to Impact.HIGH, ChangeKind.ADDED to Impact.LOW),
    ),
)

private fun Semantic.text(kind: ChangeKind) = when (kind) {
    ChangeKind.MODIFIED -> modified
    ChangeKind.REMOVED -> removed
    else -> added
}

private val BY_EXPR = Regex("\\bBy\\.\\w+\\((?:\"(?:[^\"\\\\]|\\\\.)*\"|[^()\"])*\\)")
private fun byExprs(v: Any?): List<String> = BY_EXPR.findAll(if (v === Absent || v == null) "" else v.toString()).map { it.value }.toList()

/** Lower is sturdier: ids survive layout changes; xpath and class names tend not to. */
private val STRATEGY_RANK = mapOf(
    "id" to 0, "name" to 1, "cssSelector" to 2, "className" to 3, "linkText" to 3, "partialLinkText" to 3, "tagName" to 3, "xpath" to 4,
)
private val STRATEGY = Regex("^By\\.(\\w+)\\(")
private val POSITIONAL = Regex("^By\\.xpath\\(\\s*\"(?:/html|//[\\w*]+\\[\\d+\\])|\\[\\d+\\]")

private class Shift(val note: String, val impact: Impact?)

private fun strategyShift(before: String, after: String): Shift? {
    val sb = STRATEGY.find(before)?.groupValues?.get(1)
    val sa = STRATEGY.find(after)?.groupValues?.get(1)
    if (sb == null || sa == null) return null
    if (POSITIONAL.containsMatchIn(after) && !POSITIONAL.containsMatchIn(before)) {
        return Shift(" The new locator is position-based and breaks on layout changes.", Impact.HIGH)
    }
    val rb = STRATEGY_RANK[sb]
    val ra = STRATEGY_RANK[sa]
    if (rb == null || ra == null || sb == sa) return null
    if (ra > rb) return Shift(" Moved from $sb to $sa, which is usually less stable.", null)
    return Shift(" Moved from $sb to $sa, which is usually more stable.", Impact.LOW)
}

private fun locatorChange(path: String, kind: ChangeKind, before: String? = null, after: String? = null): Change {
    val sem = SEMANTIC.getValue(QaCategory.LOCATOR)
    val shift = if (kind == ChangeKind.MODIFIED) strategyShift(before!!, after!!) else null
    return Change(
        path, kind,
        before = before ?: Absent,
        after = after ?: Absent,
        evidence = "fact",
        impact = shift?.impact ?: sem.impact[kind],
        reason = sem.text(kind) + (shift?.note ?: ""),
    )
}

private val FIND_BY_PART = Regex("\\b(id|name|xpath|css|className|linkText|partialLinkText|tagName)\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\")")

/** `@FindBy(xpath = "//a")` as `By.xpath("//a")`, so annotation locators compare like code locators. */
private fun findByAsBy(v: Any?): String? {
    if (v === Absent || v == null) return null
    val text = v.toString()
    val parts = FIND_BY_PART.findAll(text).toList()
    if (parts.isEmpty()) return text
    return parts.joinToString(" | ") { m -> "By.${if (m.groupValues[1] == "css") "cssSelector" else m.groupValues[1]}(${m.groupValues[2]})" }
}

private val SKIP_REASON = Regex("\\(\\s*([^)]+?)\\s*\\)\\s*$")
private fun skipReason(v: Any?): String? =
    if (v === Absent || v == null) null else SKIP_REASON.find(v.toString())?.groupValues?.get(1)

/** Drop entries that merely contain another entry (a parent call whose arguments changed). */
private fun dropParents(items: List<String>): List<String> =
    items.filterIndexed { i, s -> items.indices.none { j -> j != i && items[j].length < s.length && s.contains(items[j]) } }

private val FIND_ELEMENT = Regex("^\\w*\\.?findElements?$|\\.findElements?$")
private val PAGE_CALL = Regex("^\\w*[Pp]age\\w*\\.\\w+$")

private fun str(v: Any?): String = if (v === Absent) "undefined" else v.toString()

internal fun applyQaPack(changes: List<Change>): List<Change> {
    val groups = LinkedHashMap<String, LinkedHashMap<QaCategory, MutableList<QaItem>>>()
    changes.forEachIndexed { idx, change ->
        val m = CALL.find(change.path)
        if (m == null || change.kind == ChangeKind.UNCHANGED) return@forEachIndexed
        val callee = m.groupValues[1]
        val cat = categoryOf(callee) ?: return@forEachIndexed
        val method = change.path.substring(0, m.range.first)
        groups.getOrPut(method) { LinkedHashMap() }.getOrPut(cat) { ArrayList() }.add(QaItem(idx, callee, change))
    }

    val consumed = HashSet<Int>()
    val additions = ArrayList<Pair<Int, Change>>()

    for ((method, byCat) in groups) {
        for ((cat, items) in byCat) {
            val sem = SEMANTIC.getValue(cat)
            val at = items.minOf { it.idx }
            val path = "$method › ${cat.label}"
            items.forEach { consumed.add(it.idx) }

            val removed = dropParents(items.filter { it.change.kind == ChangeKind.REMOVED }.map { str(it.change.before) })
            val added = dropParents(items.filter { it.change.kind == ChangeKind.ADDED }.map { str(it.change.after) })
            val paired = minOf(removed.size, added.size)
            val pairs = items.filter { it.change.kind == ChangeKind.MODIFIED }.map { str(it.change.before) to str(it.change.after) } +
                removed.take(paired).mapIndexed { k, r -> r to added[k] }
            // A wrapper call (e.g. findElement(By.id(..))) changes only because its argument did.
            val leafPairs = pairs.filterIndexed { i, (b, a) ->
                pairs.indices.none { j -> j != i && pairs[j].first.length < b.length && b.contains(pairs[j].first) && a.contains(pairs[j].second) }
            }

            fun emit(kind: ChangeKind, before: String?, after: String?) {
                val change = if (cat == QaCategory.LOCATOR) {
                    locatorChange(path, kind, before, after)
                } else {
                    Change(path, kind, before = before ?: Absent, after = after ?: Absent, evidence = "fact", impact = sem.impact[kind], reason = sem.text(kind))
                }
                additions.add(at to change)
            }
            for ((b, a) in leafPairs) emit(ChangeKind.MODIFIED, b, a)
            for (r in removed.drop(paired)) emit(ChangeKind.REMOVED, r, null)
            for (a in added.drop(paired)) emit(ChangeKind.ADDED, null, a)
        }
    }

    // Inferred: direct Selenium interaction replaced by a page-object style call.
    for ((method, byCat) in groups) {
        val locators = byCat[QaCategory.LOCATOR] ?: emptyList()
        val direct = locators.any { it.change.kind == ChangeKind.REMOVED && FIND_ELEMENT.containsMatchIn(it.callee) }
        val prefix = "$method › call "
        val pageCall = changes.firstOrNull {
            it.kind == ChangeKind.ADDED && it.path.startsWith(prefix) && PAGE_CALL.containsMatchIn(it.path.substring(prefix.length))
        }
        if (direct && pageCall != null) {
            additions.add(
                locators.minOf { it.idx } to Change(
                    "$method › implementation", ChangeKind.MODIFIED,
                    before = "Direct Selenium interaction",
                    after = "Page Object abstraction",
                    evidence = "inferred",
                    impact = Impact.MEDIUM,
                    reason = "Possible intent: improved test abstraction (inferred, not observed). The Page Object implementation should be reviewed to confirm equivalent behaviour.",
                ),
            )
        }
    }

    // Disabling a test also adds the annotation's import; that is one change, not two.
    val disabledImports = HashSet<String>()
    for (c in changes) {
        val name = ANNO.find(c.path)?.groupValues?.get(1)?.substringAfterLast('.')
        if (c.kind == ChangeKind.ADDED && name != null && DISABLING.containsMatchIn(name)) {
            val imp = changes.firstOrNull { it.kind == ChangeKind.ADDED && it.path.startsWith("imports › ") && it.path.endsWith(".$name") }
            if (imp != null) disabledImports.add(imp.path)
        }
    }

    // Test lifecycle annotations matter more than ordinary annotations.
    val out = ArrayList<Change>()
    val byAt = HashMap<Int, MutableList<Change>>()
    for ((at, c) in additions) byAt.getOrPut(at) { ArrayList() }.add(c)
    changes.forEachIndexed { idx, c ->
        byAt[idx]?.let { out.addAll(it) }
        if (idx in consumed || c.path in disabledImports) return@forEachIndexed
        val name = ANNO.find(c.path)?.groupValues?.get(1)?.substringAfterLast('.')
        if (c.kind != ChangeKind.UNCHANGED && name != null && FIND_BY.containsMatchIn(name)) {
            out.add(locatorChange(ANNO.replaceFirst(c.path, " › locator"), c.kind, findByAsBy(c.before), findByAsBy(c.after)))
            return@forEachIndexed
        }
        // A locator declared as a field (page objects) is still a locator.
        if (c.kind != ChangeKind.UNCHANGED && !c.path.contains(" › ")) {
            val l = byExprs(c.before)
            val r = byExprs(c.after)
            val lp = "${c.path} › locator"
            if (c.kind == ChangeKind.MODIFIED && l.size + r.size > 0 && l.joinToString("\n") != r.joinToString("\n")) {
                val paired = minOf(l.size, r.size)
                for (k in 0 until paired) if (l[k] != r[k]) out.add(locatorChange(lp, ChangeKind.MODIFIED, l[k], r[k]))
                for (x in l.drop(paired)) out.add(locatorChange(lp, ChangeKind.REMOVED, x))
                for (x in r.drop(paired)) out.add(locatorChange(lp, ChangeKind.ADDED, null, x))
                return@forEachIndexed
            }
            if (c.kind == ChangeKind.ADDED && r.isNotEmpty()) {
                for (x in r) out.add(locatorChange(lp, ChangeKind.ADDED, null, x))
                return@forEachIndexed
            }
            if (c.kind == ChangeKind.REMOVED && l.isNotEmpty()) {
                for (x in l) out.add(locatorChange(lp, ChangeKind.REMOVED, x))
                return@forEachIndexed
            }
        }
        if (name != null && TEST_ANNOTATION.containsMatchIn(name) && c.kind != ChangeKind.UNCHANGED) {
            if (c.kind == ChangeKind.REMOVED) {
                out.add(c.copy(impact = Impact.HIGH, reason = "Test lifecycle annotation removed; the method may no longer run as a test or fixture."))
                return@forEachIndexed
            }
            if (c.kind == ChangeKind.ADDED && DISABLING.containsMatchIn(name)) {
                val why = skipReason(c.after)
                out.add(c.copy(impact = Impact.HIGH, reason = "Test disabled; it will no longer run.${if (!why.isNullOrEmpty()) " Reason given: $why." else ""}"))
                return@forEachIndexed
            }
            if (c.kind == ChangeKind.MODIFIED && DISABLING.containsMatchIn(name) && skipReason(c.before).isNullOrEmpty() && !skipReason(c.after).isNullOrEmpty()) {
                out.add(c.copy(impact = Impact.LOW, reason = "Skip reason documented (${skipReason(c.after)}); the test remains disabled."))
                return@forEachIndexed
            }
        }
        out.add(c)
    }
    return out
}
