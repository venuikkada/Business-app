package com.crazybusiness.core

import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.DocumentInput
import com.crazybusiness.core.api.DocumentItemInput
import com.crazybusiness.core.gst.GstCalculator
import kotlinx.coroutines.runBlocking
import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Optional contract test against a running server:
 *   CBA_API_URL=http://localhost:3000 CBA_API_EMAIL=demo@… CBA_API_PASSWORD=… gradle :core:test
 * Skipped when the variables are not set.
 */
class LiveApiTest {
    @Test fun kotlinEngineAgreesWithServerAndClientWorksEndToEnd() = runBlocking {
        val url = System.getenv("CBA_API_URL") ?: return@runBlocking println("LiveApiTest skipped (CBA_API_URL not set)")
        var token: String? = null
        var business: String? = null
        val api = ApiClient(url, { token }, { business })
        val login = api.login(System.getenv("CBA_API_EMAIL")!!, System.getenv("CBA_API_PASSWORD")!!)
        token = login.token
        val me = api.me()
        business = me.businesses.first().id
        val ctx = api.context()
        val party = api.parties(type = "customer").items.first()
        val product = api.products().items.first { it.type == "goods" && !it.trackSerials }
        val detail = api.party(party.id)
        val inter = (detail.supplyState ?: ctx.business.stateCode) != ctx.business.stateCode
        val price = BigDecimal(product.sellingPrice)
        val local = GstCalculator.calculate(
            GstCalculator.Input(listOf(GstCalculator.Line(BigDecimal("2"), price, BigDecimal(product.taxRate).stripTrailingZeros())), ctx.settings.pricesIncludeTax, inter, ctx.settings.roundOffTotals),
        )
        val created = api.createDocument(
            DocumentInput("quotation", party.id, ctx.today, listOf(DocumentItemInput(product.id, product.name, product.hsnCode, "2", product.unit, product.sellingPrice, BigDecimal(product.taxRate).toDouble())), ctx.settings.pricesIncludeTax, ctx.settings.roundOffTotals),
            ApiClient.newIdempotencyKey(),
        )
        assertEquals(local.grandTotal.toPlainString(), created.grandTotal, "Kotlin engine must match the server")
        val issued = api.finalizeDocument(created.id)
        assertTrue(issued.number!!.startsWith("QT/"))
        val dash = api.dashboard("month")
        assertTrue(dash.range.from.isNotEmpty())
        println("LiveApiTest OK: ${issued.number} ₹${issued.grandTotal}")
    }
}
