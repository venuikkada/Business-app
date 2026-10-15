package com.crazybusiness.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import com.crazybusiness.core.api.DocumentInput
import com.crazybusiness.core.drafts.DraftStore
import com.crazybusiness.core.drafts.OfflineDraft
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/** Offline invoice/quotation drafts kept on the phone until they sync. */
@Entity(tableName = "drafts")
data class DraftEntity(
    @PrimaryKey val id: String,
    val businessId: String,
    val createdAtMillis: Long,
    val docType: String,
    val partyName: String,
    /** Local estimate only — the server recalculates on sync. */
    val estimatedTotal: String,
    val inputJson: String,
    val issueOnSync: Boolean,
    val status: String,
    val error: String?,
    val serverId: String?,
)

@Dao
interface DraftDao {
    @Query("select * from drafts where businessId = :businessId and status = 'PENDING' order by createdAtMillis")
    suspend fun pending(businessId: String): List<DraftEntity>

    @Query("select * from drafts where businessId = :businessId and status != 'SYNCED' order by createdAtMillis desc")
    fun unsynced(businessId: String): Flow<List<DraftEntity>>

    @Query("select * from drafts where id = :id")
    suspend fun get(id: String): DraftEntity?

    @Upsert
    suspend fun upsert(d: DraftEntity)

    @Query("update drafts set status = 'PENDING', error = null where id = :id")
    suspend fun retry(id: String)

    @Query("delete from drafts where id = :id")
    suspend fun delete(id: String)

    /** Synced drafts are kept for a week as a receipt, then removed. */
    @Query("delete from drafts where status = 'SYNCED' and createdAtMillis < :before")
    suspend fun purgeSynced(before: Long)
}

@Database(entities = [DraftEntity::class], version = 1, exportSchema = false)
abstract class DraftDatabase : RoomDatabase() {
    abstract fun drafts(): DraftDao

    companion object {
        fun build(context: Context): DraftDatabase =
            Room.databaseBuilder(context, DraftDatabase::class.java, "cba-drafts.db").build()
    }
}

class RoomDraftStore(private val dao: DraftDao, private val json: Json) : DraftStore {
    override suspend fun pending(businessId: String): List<OfflineDraft> = dao.pending(businessId).map { it.toDraft() }

    override suspend fun save(draft: OfflineDraft) {
        val existing = dao.get(draft.id)
        dao.upsert(
            DraftEntity(
                id = draft.id,
                businessId = draft.businessId,
                createdAtMillis = draft.createdAtMillis,
                docType = draft.input.docType,
                partyName = existing?.partyName ?: "",
                estimatedTotal = existing?.estimatedTotal ?: "0",
                inputJson = json.encodeToString(DocumentInput.serializer(), draft.input),
                issueOnSync = draft.issueOnSync,
                status = draft.status.name,
                error = draft.error,
                serverId = draft.serverId,
            ),
        )
    }

    /** Saves a new draft along with the display fields the list screen needs. */
    suspend fun saveNew(draft: OfflineDraft, partyName: String, estimatedTotal: String) {
        dao.upsert(
            DraftEntity(
                draft.id, draft.businessId, draft.createdAtMillis, draft.input.docType, partyName, estimatedTotal,
                json.encodeToString(DocumentInput.serializer(), draft.input), draft.issueOnSync, draft.status.name, null, null,
            ),
        )
    }

    fun unsynced(businessId: String) = dao.unsynced(businessId)
    suspend fun retry(id: String) = dao.retry(id)
    suspend fun delete(id: String) = dao.delete(id)
    suspend fun purgeOld() = dao.purgeSynced(System.currentTimeMillis() - 7L * 24 * 3600 * 1000)

    private fun DraftEntity.toDraft() = OfflineDraft(
        id = id,
        businessId = businessId,
        createdAtMillis = createdAtMillis,
        input = json.decodeFromString(DocumentInput.serializer(), inputJson),
        issueOnSync = issueOnSync,
        status = OfflineDraft.Status.valueOf(status),
        error = error,
        serverId = serverId,
    )
}
