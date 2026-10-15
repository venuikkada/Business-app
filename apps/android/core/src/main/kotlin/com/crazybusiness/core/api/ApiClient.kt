package com.crazybusiness.core.api

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A structured API error (HTTP 4xx/5xx with the server's error code). */
class ApiException(val code: String, override val message: String, val status: Int, val details: JsonElement? = null) : Exception(message) {
    val isClientError get() = status in 400..499
    val needsLogin get() = status == 401
}

/**
 * Client for the CRAZY BUSINESS APP REST API (/api/v1). Authenticates with a
 * long-lived mobile session token (Bearer). The business is selected with the
 * X-Business-Id header. Create calls accept an Idempotency-Key so retries on
 * flaky mobile networks never create duplicates.
 */
class ApiClient(
    baseUrl: String,
    private val token: () -> String?,
    private val businessId: () -> String?,
    private val http: OkHttpClient = defaultHttp(),
) {
    private val base = baseUrl.trimEnd('/') + "/api/v1/"
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true; coerceInputValues = true }

    companion object {
        fun defaultHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .build()

        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        fun newIdempotencyKey(): String = "android-" + UUID.randomUUID().toString()
    }

    private fun url(path: String, query: Map<String, Any?> = emptyMap()) =
        (base + path.trimStart('/')).toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> if (v != null && v.toString().isNotEmpty()) addQueryParameter(k, v.toString()) }
        }.build()

    private fun request(method: String, path: String, body: String?, query: Map<String, Any?> = emptyMap(), idempotencyKey: String? = null): Request {
        val b = Request.Builder().url(url(path, query))
            .header("X-Client", "android")
            .header("Accept", "application/json")
        token()?.let { b.header("Authorization", "Bearer $it") }
        businessId()?.let { b.header("X-Business-Id", it) }
        idempotencyKey?.let { b.header("Idempotency-Key", it) }
        val rb = body?.toRequestBody(JSON_TYPE)
        return b.method(method, if (method == "GET") null else (rb ?: "{}".toRequestBody(JSON_TYPE))).build()
    }

    private suspend fun execute(req: Request): Response = suspendCancellableCoroutine { cont ->
        val call = http.newCall(req)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) { cont.resume(response) }
        })
    }

    private suspend fun raw(method: String, path: String, body: String? = null, query: Map<String, Any?> = emptyMap(), idempotencyKey: String? = null): ByteArray {
        execute(request(method, path, body, query, idempotencyKey)).use { res ->
            val bytes = res.body?.bytes() ?: ByteArray(0)
            if (!res.isSuccessful) {
                val err = runCatching { json.decodeFromString(ErrorBody.serializer(), bytes.decodeToString()).error }.getOrNull()
                throw ApiException(err?.code ?: "HTTP_${res.code}", err?.message ?: "Request failed (${res.code})", res.code, err?.details)
            }
            return bytes
        }
    }

    private suspend fun <T> call(method: String, path: String, out: KSerializer<T>, body: String? = null, query: Map<String, Any?> = emptyMap(), idempotencyKey: String? = null): T =
        json.decodeFromString(out, raw(method, path, body, query, idempotencyKey).decodeToString())

    private inline fun <reified B> enc(b: B): String = json.encodeToString(b)

    // ------------------------------------------------------------- auth
    suspend fun login(email: String, password: String, totp: String? = null) = call("POST", "auth/login", LoginResponse.serializer(), enc(LoginRequest(email, password, totp)))
    suspend fun register(r: RegisterRequest) = call("POST", "auth/register", LoginResponse.serializer(), enc(r))
    suspend fun forgotPassword(email: String) { raw("POST", "auth/forgot", enc(mapOf("email" to email))) }
    suspend fun logout() { raw("POST", "auth/logout") }
    suspend fun me() = call("GET", "me", MeResponse.serializer())

    // --------------------------------------------------------- business
    suspend fun createBusiness(r: CreateBusinessRequest) = call("POST", "businesses", IdResponse.serializer(), enc(r))
    suspend fun context() = call("GET", "context", ContextResponse.serializer())
    suspend fun dashboard(preset: String = "month") = call("GET", "dashboard", DashboardResponse.serializer(), query = mapOf("preset" to preset))
    suspend fun notifications() = call("GET", "notifications", NotificationsResponse.serializer())
    suspend fun markAllNotificationsRead() { raw("POST", "notifications/read", enc(mapOf("ids" to "all"))) }

    // ---------------------------------------------------------- parties
    suspend fun parties(q: String? = null, type: String? = null, page: Int = 1) =
        call("GET", "parties", Page.serializer(PartyRow.serializer()), query = mapOf("q" to q, "type" to type, "page" to page))
    suspend fun party(id: String) = call("GET", "parties/$id", PartyDetail.serializer())
    suspend fun createParty(r: CreatePartyRequest, key: String = newIdempotencyKey()) = call("POST", "parties", PartyDetail.serializer(), enc(r), idempotencyKey = key)
    suspend fun paymentReminder(partyId: String) = call("GET", "parties/$partyId/reminder", ReminderResponse.serializer())

    // --------------------------------------------------------- products
    suspend fun products(q: String? = null, page: Int = 1, lowStock: Boolean = false) =
        call("GET", "products", Page.serializer(ProductRow.serializer()), query = mapOf("q" to q, "page" to page, "lowStock" to if (lowStock) "true" else null))
    suspend fun productByBarcode(code: String) = call("GET", "products/barcode/${java.net.URLEncoder.encode(code, "UTF-8").replace("+", "%20")}", ProductDetail.serializer())
    suspend fun product(id: String) = call("GET", "products/$id", ProductDetail.serializer())

    // -------------------------------------------------------- documents
    suspend fun documents(type: String, status: String? = null, q: String? = null, page: Int = 1) =
        call("GET", "documents", DocumentListResponse.serializer(), query = mapOf("type" to type, "status" to status, "q" to q, "page" to page))
    suspend fun document(id: String) = call("GET", "documents/$id", DocumentDetail.serializer())
    suspend fun createDocument(input: DocumentInput, idempotencyKey: String) = call("POST", "documents", DocumentDetail.serializer(), enc(input), idempotencyKey = idempotencyKey)
    suspend fun finalizeDocument(id: String, allowNegativeStock: Boolean = false) = call("POST", "documents/$id/finalize", DocumentDetail.serializer(), enc(FinalizeRequest(allowNegativeStock = allowNegativeStock)))
    suspend fun convertDocument(id: String, target: String, finalize: Boolean = false) = call("POST", "documents/$id/convert", DocumentDetail.serializer(), enc(ConvertRequest(target, finalize)))
    suspend fun shareDocument(id: String) = call("GET", "documents/$id/share", ShareResponse.serializer())
    suspend fun markShared(id: String) { raw("POST", "documents/$id/shared") }
    suspend fun documentPdf(id: String): ByteArray = raw("GET", "documents/$id/pdf", query = mapOf("download" to "1"))

    // --------------------------------------------------------- payments
    suspend fun recordPayment(p: PaymentInput, key: String = newIdempotencyKey()) = call("POST", "payments", PaymentResult.serializer(), enc(p), idempotencyKey = key)
    suspend fun outstanding(side: String = "receivable") = call("GET", "outstanding", OutstandingResponse.serializer(), query = mapOf("side" to side))

    // --------------------------------------------------------- expenses
    suspend fun expenseCategories() = call("GET", "expense-categories", ListSerializer(ExpenseCategory.serializer()))
    suspend fun createExpense(e: ExpenseInput, key: String = newIdempotencyKey()) = call("POST", "expenses", IdResponse.serializer(), enc(e), idempotencyKey = key)
}
