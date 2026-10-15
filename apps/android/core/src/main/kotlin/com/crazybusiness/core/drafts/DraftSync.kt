package com.crazybusiness.core.drafts

import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.api.DocumentInput
import java.io.IOException

/**
 * An invoice/quotation saved on the phone while offline. Its id doubles as the
 * Idempotency-Key, so a draft that reached the server before the connection
 * dropped is never created twice when the sync retries.
 */
data class OfflineDraft(
    val id: String,
    val businessId: String,
    val createdAtMillis: Long,
    val input: DocumentInput,
    val issueOnSync: Boolean,
    val status: Status = Status.PENDING,
    val error: String? = null,
    val serverId: String? = null,
) {
    enum class Status { PENDING, SYNCED, NEEDS_ATTENTION }
}

interface DraftStore {
    suspend fun pending(businessId: String): List<OfflineDraft>
    suspend fun save(draft: OfflineDraft)
}

data class SyncReport(val synced: Int, val needsAttention: Int, val stillPending: Int, val offline: Boolean)

/**
 * Pushes pending offline drafts to the server, oldest first.
 * - Network failure: stop and keep everything pending (retry later).
 * - Validation / business-rule / plan-limit errors: mark the draft as needing
 *   attention with the server's message; the user fixes it in the app.
 * - Server is the source of truth for numbers and totals; the local draft is
 *   replaced by the server document once synced.
 */
class DraftSyncer(private val store: DraftStore, private val api: ApiClient) {
    suspend fun syncAll(businessId: String): SyncReport {
        var synced = 0
        var attention = 0
        val pending = store.pending(businessId).sortedBy { it.createdAtMillis }
        for ((index, d) in pending.withIndex()) {
            try {
                val created = api.createDocument(d.input, idempotencyKey = d.id)
                if (d.issueOnSync && created.status == "draft") {
                    try {
                        api.finalizeDocument(created.id)
                    } catch (e: ApiException) {
                        // Already issued (e.g. a previous attempt succeeded) counts as done.
                        if (e.code != "CONFLICT") {
                            store.save(d.copy(status = OfflineDraft.Status.NEEDS_ATTENTION, error = "Saved on server as draft, not issued: ${e.message}", serverId = created.id))
                            attention++
                            continue
                        }
                    }
                }
                store.save(d.copy(status = OfflineDraft.Status.SYNCED, error = null, serverId = created.id))
                synced++
            } catch (e: IOException) {
                return SyncReport(synced, attention, pending.size - index, offline = true)
            } catch (e: ApiException) {
                if (e.needsLogin || e.status >= 500 || e.status == 429) {
                    return SyncReport(synced, attention, pending.size - index, offline = false)
                }
                store.save(d.copy(status = OfflineDraft.Status.NEEDS_ATTENTION, error = e.message))
                attention++
            }
        }
        return SyncReport(synced, attention, 0, offline = false)
    }
}
