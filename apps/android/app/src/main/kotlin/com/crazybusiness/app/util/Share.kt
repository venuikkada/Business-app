package com.crazybusiness.app.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

object Share {
    /** Opens a link (wa.me WhatsApp link, UPI link, web page) in the matching app. */
    fun openUrl(context: Context, url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No app found to open this link", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Writes the PDF to the app's private cache (cache/pdfs, exposed only via
     * FileProvider with a temporary read grant) and opens the share sheet.
     */
    fun sharePdf(context: Context, bytes: ByteArray, fileName: String, message: String? = null) {
        val dir = File(context.cacheDir, "pdfs").apply { mkdirs() }
        // Old shared PDFs are not needed once shared; keep the cache small.
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600 * 1000 }?.forEach { it.delete() }
        val safe = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val file = File(dir, safe).apply { writeBytes(bytes) }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            message?.let { putExtra(Intent.EXTRA_TEXT, it) }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "Share PDF").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
