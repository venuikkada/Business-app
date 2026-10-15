package com.crazybusiness.app

import android.app.Application
import com.crazybusiness.app.data.DraftDatabase
import com.crazybusiness.app.data.RoomDraftStore
import com.crazybusiness.app.data.SessionStore
import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ContextResponse
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

class CbaApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/**
 * Simple manual dependency container. The session token lives only in memory
 * and in Keystore-encrypted DataStore; no server secrets are ever shipped in
 * the app — the API enforces every permission and plan limit.
 */
class AppContainer(app: Application) {
    val session = SessionStore(app)
    val api = ApiClient(BuildConfig.API_BASE_URL, token = { session.token }, businessId = { session.businessId })
    val db = DraftDatabase.build(app)
    val drafts = RoomDraftStore(db.drafts(), api.json)

    /** The selected business's context (role, permissions, plan, settings). */
    val context = MutableStateFlow<ContextResponse?>(null)

    /** Emitted when the server rejects the session (expired / revoked). */
    val authExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    fun onAuthExpired() {
        authExpired.tryEmit(Unit)
    }
}
