package com.razatech.diffsense.ide

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VfsUtilCore

/** One side of a comparison: a real file (opened in the diff as such) or in-memory text. */
class Side(val name: String, val text: String, val file: VirtualFile? = null) {
    companion object {
        /** Reads the editor's current (possibly unsaved) text. Call under a read action. */
        fun of(file: VirtualFile, maxBytes: Long): Side {
            val doc = FileDocumentManager.getInstance().getCachedDocument(file)
            if (doc == null && file.length > maxBytes) {
                throw IllegalArgumentException("${file.name} is larger than the ${maxBytes / 1_048_576} MB limit (Settings | Tools | DiffSense)")
            }
            val text = doc?.text ?: VfsUtilCore.loadText(file)
            return Side(file.name, text, file)
        }
    }
}
