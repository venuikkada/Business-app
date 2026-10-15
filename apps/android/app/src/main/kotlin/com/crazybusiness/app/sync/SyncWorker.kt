package com.crazybusiness.app.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.crazybusiness.app.CbaApplication
import com.crazybusiness.core.drafts.DraftSyncer
import java.util.concurrent.TimeUnit

/**
 * Uploads offline drafts once the phone is online. Runs as unique work so two
 * syncs never race; each draft's id is its Idempotency-Key, so a retry after a
 * dropped connection never creates a duplicate invoice.
 */
class SyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as CbaApplication).container
        c.session.load()
        val business = c.session.businessId ?: return Result.success()
        if (c.session.token == null) return Result.success()
        val report = DraftSyncer(c.drafts, c.api).syncAll(business)
        c.drafts.purgeOld()
        return if (report.stillPending > 0) Result.retry() else Result.success()
    }

    companion object {
        private const val NAME = "draft-sync"

        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
