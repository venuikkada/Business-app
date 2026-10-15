package com.crazybusiness.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts small secrets (the session token) with an AES-256-GCM key that
 * never leaves the Android Keystore. If the key is lost (e.g. device restore)
 * decryption fails and the user simply signs in again.
 */
object CryptoBox {
    private const val ALIAS = "cba_session_key"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    fun decrypt(encoded: String): String? = runCatching {
        val all = Base64.decode(encoded, Base64.NO_WRAP)
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
        String(c.doFinal(all.copyOfRange(12, all.size)), Charsets.UTF_8)
    }.getOrNull()
}

private val Context.sessionDataStore by preferencesDataStore("session")

/** Persists the session token (encrypted), selected business and onboarding flag. */
class SessionStore(private val context: Context) {
    private object K {
        val TOKEN = stringPreferencesKey("token_enc")
        val BUSINESS = stringPreferencesKey("business_id")
        val USER_NAME = stringPreferencesKey("user_name")
        val ONBOARDED = booleanPreferencesKey("onboarding_seen")
    }

    @Volatile var token: String? = null
        private set
    @Volatile var businessId: String? = null
        private set
    @Volatile var userName: String? = null
        private set
    var onboardingSeen: Boolean = false
        private set

    suspend fun load() {
        val p = context.sessionDataStore.data.first()
        token = p[K.TOKEN]?.let(CryptoBox::decrypt)
        businessId = p[K.BUSINESS]
        userName = p[K.USER_NAME]
        onboardingSeen = p[K.ONBOARDED] ?: false
    }

    suspend fun signedIn(token: String, userName: String) {
        this.token = token
        this.userName = userName
        context.sessionDataStore.edit {
            it[K.TOKEN] = CryptoBox.encrypt(token)
            it[K.USER_NAME] = userName
        }
    }

    suspend fun selectBusiness(id: String?) {
        businessId = id
        context.sessionDataStore.edit { if (id == null) it.remove(K.BUSINESS) else it[K.BUSINESS] = id }
    }

    suspend fun markOnboardingSeen() {
        onboardingSeen = true
        context.sessionDataStore.edit { it[K.ONBOARDED] = true }
    }

    suspend fun clear() {
        token = null
        businessId = null
        userName = null
        context.sessionDataStore.edit {
            it.remove(K.TOKEN)
            it.remove(K.BUSINESS)
            it.remove(K.USER_NAME)
        }
    }
}
