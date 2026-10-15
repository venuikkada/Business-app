package com.crazybusiness.core

import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.api.DocumentInput
import com.crazybusiness.core.api.DocumentItemInput
import com.crazybusiness.core.drafts.DraftStore
import com.crazybusiness.core.drafts.DraftSyncer
import com.crazybusiness.core.drafts.OfflineDraft
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient

    @BeforeTest fun setUp() {
        server = MockWebServer()
        server.start()
        api = ApiClient(server.url("/").toString(), token = { "cba_testtoken" }, businessId = { "11111111-1111-1111-1111-111111111111" })
    }

    @AfterTest fun tearDown() = server.shutdown()

    private val docJson = """{"id":"d1","docType":"invoice","number":null,"status":"draft","issueDate":"2026-10-15","partyId":"p1","partyName":"Ravi","placeOfSupply":"29","isInterState":false,"taxableTotal":"100.00","cgstTotal":"9.00","sgstTotal":"9.00","igstTotal":"0.00","roundOff":"0.00","grandTotal":"118.00","items":[],"unknownField":123}"""
    private val input = DocumentInput("invoice", "p1", "2026-10-15", listOf(DocumentItemInput(description = "Item", quantity = "1", unitPrice = "100", taxRate = 18.0)))

    @Test fun sendsAuthBusinessAndIdempotencyHeaders() = runTest {
        server.enqueue(MockResponse().setBody(docJson))
        val d = api.createDocument(input, "android-key-1")
        assertEquals("118.00", d.grandTotal)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/v1/documents", req.path)
        assertEquals("Bearer cba_testtoken", req.getHeader("Authorization"))
        assertEquals("11111111-1111-1111-1111-111111111111", req.getHeader("X-Business-Id"))
        assertEquals("android", req.getHeader("X-Client"))
        assertEquals("android-key-1", req.getHeader("Idempotency-Key"))
        assertTrue(req.body.readUtf8().contains("\"taxRate\":18.0"))
    }

    @Test fun mapsServerErrors() = runTest {
        server.enqueue(MockResponse().setResponseCode(402).setBody("""{"error":{"code":"PLAN_LIMIT","message":"Your free plan allows 30 invoices per month."}}"""))
        val e = assertFailsWith<ApiException> { api.finalizeDocument("d1") }
        assertEquals("PLAN_LIMIT", e.code)
        assertEquals(402, e.status)
        assertTrue(e.isClientError)
    }

    private class MemoryStore(var drafts: MutableList<OfflineDraft>) : DraftStore {
        override suspend fun pending(businessId: String) = drafts.filter { it.businessId == businessId && it.status == OfflineDraft.Status.PENDING }
        override suspend fun save(draft: OfflineDraft) { drafts.replaceAll { if (it.id == draft.id) draft else it } }
    }

    @Test fun offlineDraftsSyncWithStableIdempotencyKeys() = runTest {
        val d1 = OfflineDraft("android-draft-1", "b", 1, input, issueOnSync = true)
        val d2 = OfflineDraft("android-draft-2", "b", 2, input, issueOnSync = false)
        val store = MemoryStore(mutableListOf(d1, d2))
        val syncer = DraftSyncer(store, api)

        // 1st attempt: network drops on the first create → nothing changes.
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val r1 = syncer.syncAll("b")
        assertTrue(r1.offline)
        assertEquals(2, r1.stillPending)

        // 2nd attempt: d1 created + issued; d2 rejected by validation.
        server.enqueue(MockResponse().setBody(docJson))
        server.enqueue(MockResponse().setBody(docJson.replace("\"status\":\"draft\"", "\"status\":\"issued\"")))
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"error":{"code":"VALIDATION","message":"Customer/supplier not found"}}"""))
        val r2 = syncer.syncAll("b")
        assertEquals(1, r2.synced)
        assertEquals(1, r2.needsAttention)
        assertEquals(OfflineDraft.Status.SYNCED, store.drafts[0].status)
        assertEquals("Customer/supplier not found", store.drafts[1].error)

        server.takeRequest() // dropped attempt
        assertEquals("android-draft-1", server.takeRequest().getHeader("Idempotency-Key"))
        assertEquals("/api/v1/documents/d1/finalize", server.takeRequest().path)
        assertEquals("android-draft-2", server.takeRequest().getHeader("Idempotency-Key"))
    }
}
