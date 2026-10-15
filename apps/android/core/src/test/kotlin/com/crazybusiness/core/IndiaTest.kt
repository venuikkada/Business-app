package com.crazybusiness.core

import com.crazybusiness.core.india.India
import java.math.BigDecimal
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class IndiaTest {
    @Test fun gstinChecksumMatchesPublishedExample() {
        assertEquals('V', India.gstinCheckChar("27AAPFU0939F1Z"))
        assertNull(India.validateGstin("27AAPFU0939F1ZV"))
        assertEquals("GSTIN checksum does not match", India.validateGstin("27AAPFU0939F1ZA"))
    }

    @Test fun phones() {
        assertEquals("+919876543210", India.normalizePhone("98765 43210"))
        assertEquals("+919876543210", India.normalizePhone("+91-98765-43210"))
        assertNull(India.normalizePhone("12345"))
        assertEquals("+91 98765 43210", India.formatPhone("+919876543210"))
    }

    @Test fun indianGroupingAndWords() {
        assertEquals("₹1,23,456.70", India.inr(BigDecimal("123456.7")))
        assertEquals("-₹1,000.00", India.inr(BigDecimal("-1000")))
        assertEquals("₹999.00", India.inr(BigDecimal("999")))
        assertEquals("Rupees One Thousand One Hundred Eighty and Fifty Paise Only", India.amountInWords(BigDecimal("1180.50")))
        assertEquals("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight", India.numberToWords(12345678))
    }

    @Test fun financialYear() {
        assertEquals("2026-27", India.financialYear(LocalDate.of(2026, 4, 1)))
        assertEquals("2025-26", India.financialYear(LocalDate.of(2026, 3, 31)))
    }
}
