// Generated from the approved OpenAPI 0.4.0 increment 1 contract.
export interface paths {
    "/auth/otp/challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** start Customer Challenge */
        post: operations["startCustomerChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/otp/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** verify Customer Challenge */
        post: operations["verifyCustomerChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * start Admin Session
         * @description Verify an unused admin-only challenge against the current enrolled destination and epoch. RECOVERY atomically revokes prior sessions and invalidates earlier admin challenges. This never provisions an account.
         */
        post: operations["startAdminSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * start Admin Challenge
         * @description Role-bound challenge for the enrolled admin contact only. RECOVERY is optional, default SIGN_IN. If no enrolled channel is available, use restricted manual owner verification; no public contact-reset or enrollment endpoint.
         */
        post: operations["startAdminChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Session */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/session/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** logout Session */
        post: operations["logoutSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** list Catalog */
        get: operations["listCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Cart */
        get: operations["getCart"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cart/items/{variantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** set Cart Quantity */
        put: operations["setCartQuantity"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** evaluate Availability */
        post: operations["evaluateAvailability"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** list Own Orders */
        get: operations["listOwnOrders"];
        put?: never;
        /** submit Order */
        post: operations["submitOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Own Order */
        get: operations["getOwnOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/confirm-fee": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** confirm Delivery Fee */
        post: operations["confirmDeliveryFee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * cancel Own Order
         * @description Cancel an owned, unpaid and unaccepted order only before transfer. Recorded proof, receipts or unresolved transfer evidence block cancellation. A customer who sent or may have sent a transfer uses the external merchant WhatsApp contact instead.
         */
        post: operations["cancelOwnOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/charges/{chargeId}/proof": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * submit Charge Proof
         * @description Register standard top-up proof before the current 30-minute cutoff to keep capacity through review. Timely event balance proof before the effective grace cutoff (or effective due time if there is no separate grace) protects the slot through review. Late evidence enters merchant reconciliation and cannot reopen an order, booking or allocation.
         */
        post: operations["submitChargeProof"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/work": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** list Merchant Work */
        get: operations["listMerchantWork"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Merchant Order */
        get: operations["getMerchantOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** list Merchant Products */
        get: operations["listMerchantProducts"];
        put?: never;
        /** create Product */
        post: operations["createProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/products/{productId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Merchant Product */
        get: operations["getMerchantProduct"];
        /**
         * update Product
         * @description Saves ordered photo IDs in the same versioned write as catalogue fields. The first attached ID is the cover. Detached photos stop serving to customers; staged or foreign product IDs cannot be attached except valid staged media for this product.
         */
        put: operations["updateProduct"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * configure Capacity
         * @description Confirm the reviewed edit with its impact token. A change to date revision, affected order membership or state (including unallocated Cash or fee requests), or the edit requires a fresh preview. Closure preserves accepted orders. Caps below occupied or used quantities are refused.
         */
        put: operations["configureCapacity"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders/{orderId}/fee": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * quote Delivery Fee
         * @description Merchant may counteroffer a viable handoff and fee before rejection. Serviceable offers require both values. Persist the exact offered terms and revision independently of the accepted promise.
         */
        post: operations["quoteDeliveryFee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders/{orderId}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * change Standard Order
         * @description Driver arrival is a distinct delivery fact. Incidents can be recorded before or after handoff. MERCHANT_UNABLE cancellation records the full remaining verified-receipts refund obligation under the same lock; manual payout uses a refund intent.
         */
        post: operations["changeStandardOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}/proofs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** list Payment Proofs */
        get: operations["listPaymentProofs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/proofs/{proofId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Payment Proof Content */
        get: operations["getPaymentProofContent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * confirm Receipt
         * @description NORMAL matches the exact expected balance. SUPPLEMENT binds the open mismatch case and posts one independently verified top-up. Only an exact combined total on an eligible, feasible order may accept. After the top-up cutoff, acceptance requires proof registered before the current deadline even if expiry work has not run. RECONCILIATION records actual funds without reopening. For late event deposit verification under DEC-021 include lateDepositDecision; server checks deadline and records the effective 24-hour window or reschedule/refund case.
         */
        post: operations["confirmReceipt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/proofs/{proofId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * reject Proof
         * @description Reject evidence without treating it as proof of no transfer. REQUEST_SUPPLEMENT applies to a verified shortfall with an active standard allocation. It issues the top-up notice and fixes a deadline 30 minutes after issuance, without resetting an active deadline on retry. A timely top-up proof keeps the hold through review; expiry with no timely proof releases unused capacity and leaves funds in reconciliation. REJECT_STANDARD_ORDER and REJECT_EVENT_DEPOSIT release unused capacity or window respectively, with verified receipts handled separately.
         */
        post: operations["rejectProof"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * record Refund
         * @description Confirm an independently verified payout against the matching reserved refund intent. Use the actual movement reference and current charge version.
         */
        post: operations["recordRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/checkout/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** review Checkout */
        post: operations["reviewCheckout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}/refund-intents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** reserve Refund */
        post: operations["reserveRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Charge For Review */
        get: operations["getChargeForReview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/capacity-calendar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Capacity Calendar */
        get: operations["getCapacityCalendar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/commands/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Own Command Outcome */
        get: operations["getOwnCommandOutcome"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/checkout/reviews/{reviewId}/outcome": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** get Checkout Outcome */
        get: operations["getCheckoutOutcome"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/checkout/reviews/{reviewId}/abandon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * abandon Or Resolve Checkout
         * @description Lock review; return the existing order if submitted, otherwise prevent every future submission of this review before a new intent may start.
         */
        post: operations["abandonOrResolveCheckout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/charges/{chargeId}/settlement-cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** open Settlement Case */
        post: operations["openSettlementCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/settlement-cases/{caseId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** resolve Settlement Case */
        post: operations["resolveSettlementCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/refund-intents/{refundIntentId}/reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * reconcile Refund Intent
         * @description Mark uncertain without releasing funds, or void only after verifying the payout did not occur. Confirmed payout uses recordRefund against this same intent.
         */
        post: operations["reconcileRefundIntent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders/{orderId}/reschedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * reschedule Standard Order
         * @description Agreement must cover the revised promise. Use same allocation transaction to preserve original commitment if the change fails.
         */
        post: operations["rescheduleStandardOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders/{orderId}/delivery-adjustments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * create Delivery Adjustment
         * @description Create a separately tracked DuitNow charge only after recorded customer agreement to the fee. The accepted original order total remains unchanged.
         */
        post: operations["createDeliveryAdjustment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/products/{productId}/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * upload Product Photo
         * @description Admin only. Validate at most 5 MiB, file signature and decode; normalize or reject. Stage candidate for the specified product without changing its saved gallery.
         */
        post: operations["uploadProductPhoto"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/products/{productId}/media/{mediaId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * get Merchant Product Photo
         * @description Admin-only scoped staging/gallery preview. No proof objects served here.
         */
        get: operations["getMerchantProductPhoto"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/media/{mediaId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * get Listed Product Photo
         * @description Customer session required. Serve only current attached media of a listed product. Unlisted, sold-out, unattached or unknown media returns non-disclosing 404.
         */
        get: operations["getListedProductPhoto"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/capacity/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * preview Capacity Impact
         * @description Preview scoped impacted orders for proposed closure or cap change. Token binds proposed date, version and normalized edit. No order or allocation mutations.
         */
        post: operations["previewCapacityImpact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operating-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * get Operating Policy
         * @description Read active shop handoff calendar defaults and fixed approved cutoffs.
         */
        get: operations["getOperatingPolicy"];
        /**
         * update Operating Policy
         * @description Change weekly handoff availability for new commitments only. Keep existing promises; shop remains open for online requests.
         */
        put: operations["updateOperatingPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/products/{productId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get listed catalogue product
         * @description Requires a customer session. Read the current listed product with eligible variants and ordered photo IDs. Hidden or missing items return a safe 404.
         */
        get: operations["getListedProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Address: {
            line1: string;
            line2?: string;
            city: string;
            postcode: string;
            region: string;
            note?: string;
        };
        Challenge: {
            /** Format: uuid */
            challengeId: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            resendAt: string;
        };
        Session: {
            /** Format: uuid */
            accountId: string;
            /** @enum {string} */
            role: "CUSTOMER" | "ADMIN";
            csrfToken: string;
            /** Format: date-time */
            expiresAt: string;
        };
        Variant: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            productId: string;
            name: string;
            flavour: string;
            unitMinor: number;
            prepMinutes: number;
            available: boolean;
        };
        Product: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            status: "DRAFT" | "LISTED" | "UNLISTED" | "SUSPENDED" | "SOLD_OUT" | "ARCHIVED";
            variants: components["schemas"]["Variant"][];
            imageRefs: string[];
            version: number;
            category: string | null;
        };
        Cart: {
            version: number;
            lines: {
                /** Format: uuid */
                variantId: string;
                quantity: number;
                product: string;
                variant: string;
                unitMinor: number;
                available: boolean;
            }[];
            referenceSubtotalMinor: number;
        };
        SubmitOrder: {
            cartVersion: number;
            items: {
                /** Format: uuid */
                variantId: string;
                quantity: number;
            }[];
            /** @enum {string} */
            fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
            /** @enum {string} */
            paymentMethod: "DUITNOW" | "CASH";
            /** Format: date-time */
            requestedHandoffAt: string;
            contactName: string;
            phone: string;
            address?: components["schemas"]["Address"];
            termsVersion: string;
            /** Format: uuid */
            reviewId: string;
            /** Format: email */
            notificationEmail?: string;
        } & unknown;
        Charge: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            category: "STANDARD" | "EVENT_DEPOSIT" | "EVENT_BALANCE" | "EVENT_EXTRA" | "STANDARD_ADJUSTMENT";
            expectedMinor: number;
            paidMinor: number;
            refundedMinor: number;
            dueAt: string | null;
            /** @enum {string} */
            state: "OPEN" | "PROOF_REVIEW" | "PAID" | "DISPUTED" | "EXPIRED" | "CANCELLED" | "PARTIALLY_REFUNDED" | "REFUNDED";
            qrUrl: string | null;
            version: number;
            refundableMinor: number;
            reviewStatus: string | null;
            allowedActions: string[];
            /** @description Expected amount minus verified unapplied/refundable-adjusted receipts, clamped to zero. Server applies eligible settlement guards separately. */
            outstandingMinor: number;
            /** @description Unfulfilled portion of a merchant-inability full-refund obligation, derived per verified receipt. */
            requiredRefundMinor: number;
            /** @description The current standard-order top-up request. Null when no active request exists. */
            topUp: {
                outstandingMinor: number;
                /** Format: date-time */
                requestedAt: string;
                /** Format: date-time */
                dueAt: string;
                /** @enum {string} */
                status: "AWAITING_PROOF" | "UNDER_REVIEW";
            } | null;
        };
        Order: {
            /** Format: uuid */
            id: string;
            number: string;
            version: number;
            /** @enum {string} */
            status: "AWAITING_FEE" | "AWAITING_CASH" | "PENDING_PROOF" | "PAYMENT_REVIEW" | "EXCEPTION" | "ACCEPTED" | "PREPARING" | "READY" | "HANDED_OFF" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED" | "NO_SHOW";
            /** @enum {string} */
            fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
            /** @enum {string} */
            paymentMethod: "DUITNOW" | "CASH";
            /** Format: date-time */
            requestedHandoffAt: string;
            readyAt: string | null;
            handoffAt: string | null;
            pickupDisplay: string | null;
            address: components["schemas"]["Address"] | null;
            items: {
                /** Format: uuid */
                variantId: string;
                product: string;
                variant: string;
                quantity: number;
                unitMinor: number;
                flavour: string;
            }[];
            subtotalMinor: number;
            feeMinor: number | null;
            totalMinor: number | null;
            termsVersion: string;
            feeVersion: number | null;
            proofDueAt: string | null;
            charge: components["schemas"]["Charge"] | null;
            feeOffer: components["schemas"]["FeeOffer"] | null;
            promisedHandoffAt: string | null;
            allowedActions: string[];
            safeOutcome: string | null;
            /** Format: uuid */
            checkoutReviewId: string;
            adjustments: components["schemas"]["Charge"][];
            driverArrivedAt: string | null;
            contactName: string;
            phone: string;
            notificationEmail: string | null;
            termsText: string;
        };
        EventRequest: {
            /** Format: date */
            eventDate: string;
            /** Format: date-time */
            startAt: string;
            /** Format: date-time */
            expectedEndAt: string;
            /** Format: date-time */
            setupReadyAt: string;
            venue: components["schemas"]["Address"];
            guestCount: number;
            budgetMinor: number;
            occasion: string;
            theme: string;
            specialRequirements: string;
            contactName: string;
            phone: string;
            /** Format: email */
            notificationEmail?: string;
        };
        Equipment: {
            name: string;
            quantity: number;
            /** Format: uuid */
            id: string;
        };
        Quote: {
            /** Format: uuid */
            id: string;
            version: number;
            totalMinor: number;
            depositMinor: number;
            balanceMinor: number;
            /** Format: date-time */
            issuedAt: string;
            /** Format: date-time */
            depositDueAt: string;
            /** Format: date-time */
            balanceDueAt: string;
            packageSummary: string;
            equipment: components["schemas"]["Equipment"][];
            extraChargeTerms: string;
            termsVersion: string;
            /** @enum {string} */
            status: "OFFERED" | "CUSTOMER_ACCEPTED" | "CONFIRMED" | "SUPERSEDED" | "EXPIRED" | "CANCELLED";
            termsText: string;
            /** Format: date-time */
            balanceGraceEndsAt: string;
            schedule: components["schemas"]["EventSchedule"];
            serviceSummary: string;
        };
        Event: {
            /** Format: uuid */
            id: string;
            number: string;
            version: number;
            /** @enum {string} */
            status: "APPLIED" | "QUOTED" | "DEPOSIT_REVIEW" | "BOOKED" | "BALANCE_GRACE" | "PROCEEDING" | "EQUIPMENT_CHECK" | "ADDITIONAL_BILL" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "DECLINED" | "EXCEPTION" | "AWAITING_DEPOSIT";
            request: components["schemas"]["EventRequest"];
            quote: components["schemas"]["Quote"] | null;
            charges: components["schemas"]["Charge"][];
            allowedActions: string[];
            actualSetupAt: string | null;
            actualEndAt: string | null;
            actualTeardownAt: string | null;
            extraInvoices: {
                /** Format: uuid */
                chargeId: string;
                /** Format: date-time */
                dueAt: string;
                lines: {
                    reason: string;
                    amountMinor: number;
                    item: string;
                }[];
            }[];
            effectiveBalanceDueAt: string | null;
            effectiveBalanceGraceEndsAt: string | null;
            alternativeSchedule: components["schemas"]["EventSchedule"] | null;
            effectiveSchedule: components["schemas"]["EventSchedule"] | null;
            safeOutcome: string | null;
            balanceDeadlineRevision: number;
        };
        Proof: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            chargeId: string;
            /** @enum {string} */
            state: "REVIEW" | "ACCEPTED" | "REJECTED";
            /** Format: date-time */
            receivedAt: string;
            /** @enum {string} */
            reviewDisposition: "TIMELY" | "RECONCILIATION_ONLY";
        };
        Problem: {
            /** @enum {string} */
            code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "OTP_INVALID" | "OTP_EXPIRED" | "RATE_LIMITED" | "CAPACITY_UNAVAILABLE" | "VERSION_CONFLICT" | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT" | "DEADLINE_PASSED" | "UNSUPPORTED_MEDIA" | "PAYLOAD_TOO_LARGE" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL" | "REVIEW_STALE" | "TERMS_CHANGED" | "FEE_CHANGED" | "QUOTE_EXPIRED" | "PROOF_NOT_REVIEWABLE" | "REFUND_LIMIT_EXCEEDED" | "ORIGIN_DENIED" | "DEPOSIT_DISPOSITION_REQUIRED";
            /** @example Review the current total and handoff before submitting. */
            message: string;
            requestId: string;
            fieldErrors?: {
                field: string;
                code: string;
            }[];
            retryable: boolean;
        };
        ReceiptCommand: {
            externalReference: string;
            amountMinor: number;
            /** Format: date-time */
            receivedAt: string;
            reason?: string;
            /** Format: uuid */
            proofId?: string;
            expectedVersion: number;
            /** Format: uuid */
            settlementCaseId?: string;
            /** @enum {string} */
            postingMode?: "NORMAL" | "RECONCILIATION" | "SUPPLEMENT";
            lateDepositDecision?: {
                /** @enum {string} */
                disposition: "FEASIBLE_24H" | "RESCHEDULE_OR_REFUND";
                reason: string;
            };
        };
        RefundCommand: {
            externalReference: string;
            amountMinor: number;
            /** Format: date-time */
            refundedAt: string;
            reason: string;
            expectedVersion: number;
            /** Format: uuid */
            refundIntentId: string;
        };
        WorkItem: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "ORDER" | "EVENT" | "PROOF" | "NOTICE" | "PAYMENT_EXCEPTION";
            status: string;
            number: string;
            /** Format: date-time */
            updatedAt: string;
            target: {
                /** @enum {string} */
                resourceType: "ORDER" | "EVENT" | "PROOF" | "NOTICE" | "PAYMENT_EXCEPTION";
                /** Format: uuid */
                resourceId: string;
                orderId: string | null;
                eventId: string | null;
                chargeId: string | null;
            };
            safeNextAction: string;
            noticeOutcome: ("DELIVERED" | "FAILED" | "UNKNOWN") | null;
        };
        Report: {
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            /** @constant */
            timezone: "Asia/Kuala_Lumpur";
            /** @constant */
            currency: "MYR";
            totals: {
                /** @enum {string} */
                category: "STANDARD" | "EVENT_DEPOSIT" | "EVENT_BALANCE" | "EVENT_EXTRA";
                receivedMinor: number;
                refundedMinor: number;
                netMinor: number;
            }[];
            acceptedStandard: number;
            confirmedEvents: number;
            duePrepUnits: number;
            prepByDay: {
                /** Format: date */
                date: string;
                units: number;
            }[];
            readyOnTime: number;
            dueWithPromise: number;
            quotedApplications: number;
            quotedWithConfirmedDeposit: number;
            orderCountsByStatus: {
                /** @enum {string} */
                status: "AWAITING_FEE" | "AWAITING_CASH" | "PENDING_PROOF" | "PAYMENT_REVIEW" | "EXCEPTION" | "ACCEPTED" | "PREPARING" | "READY" | "HANDED_OFF" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED" | "NO_SHOW";
                count: number;
            }[];
        };
        FeeOffer: {
            revision: number;
            serviceable: boolean;
            offeredHandoffAt: string | null;
            feeMinor: number | null;
            totalMinor: number | null;
            termsVersion: string;
            safeReason: string | null;
            termsText: string;
        };
        AdminOrder: {
            /** Format: uuid */
            id: string;
            number: string;
            version: number;
            /** @enum {string} */
            status: "AWAITING_FEE" | "AWAITING_CASH" | "PENDING_PROOF" | "PAYMENT_REVIEW" | "EXCEPTION" | "ACCEPTED" | "PREPARING" | "READY" | "HANDED_OFF" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED" | "NO_SHOW";
            /** @enum {string} */
            fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
            /** @enum {string} */
            paymentMethod: "DUITNOW" | "CASH";
            /** Format: date-time */
            requestedHandoffAt: string;
            readyAt: string | null;
            handoffAt: string | null;
            pickupDisplay: string | null;
            address: components["schemas"]["Address"] | null;
            items: {
                /** Format: uuid */
                variantId: string;
                product: string;
                variant: string;
                quantity: number;
                unitMinor: number;
                flavour: string;
            }[];
            subtotalMinor: number;
            feeMinor: number | null;
            totalMinor: number | null;
            termsVersion: string;
            feeVersion: number | null;
            proofDueAt: string | null;
            charge: components["schemas"]["Charge"] | null;
            feeOffer: components["schemas"]["FeeOffer"] | null;
            promisedHandoffAt: string | null;
            allowedActions: string[];
            safeOutcome: string | null;
            contactName: string;
            contactPhone: string;
            recentHistory: {
                action: string;
                /** Format: date-time */
                at: string;
                safeReason: string | null;
            }[];
            /** Format: uuid */
            checkoutReviewId: string;
            adjustments: components["schemas"]["Charge"][];
            driverArrivedAt: string | null;
            notificationEmail: string | null;
            termsText: string;
        };
        CheckoutReview: {
            /** Format: uuid */
            reviewId: string;
            /** Format: date-time */
            expiresAt: string;
            cartVersion: number;
            /** Format: date-time */
            requestedHandoffAt: string;
            /** @enum {string} */
            fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
            items: {
                /** Format: uuid */
                variantId: string;
                product: string;
                variant: string;
                quantity: number;
                unitMinor: number;
                flavour: string;
            }[];
            subtotalMinor: number;
            feeMinor: number | null;
            totalMinor: number | null;
            termsVersion: string;
            termsText: string;
            eligible: boolean;
            lineIssues: {
                /** Format: uuid */
                variantId: string;
                reason: string;
            }[];
            alternatives: string[];
            paymentMethods: ("CASH" | "DUITNOW")[];
            instructions: string;
            contactName: string;
            phone: string;
            address: components["schemas"]["Address"] | null;
            pickupDisplay: string | null;
            notificationEmail: string | null;
        };
        CheckoutOutcome: {
            /** @enum {string} */
            state: "OPEN" | "SUBMITTED" | "ABANDONED" | "EXPIRED";
            orderId: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        RefundIntent: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            receiptId: string;
            amountMinor: number;
            /** @enum {string} */
            state: "RESERVED" | "UNCERTAIN" | "POSTED" | "VOIDED";
            /** Format: date-time */
            updatedAt: string;
        };
        SettlementCase: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            chargeId: string;
            /** @enum {string} */
            reason: "LATE_PROOF" | "AMOUNT_MISMATCH" | "TRANSFER_UNMATCHED" | "EVENT_FULFILMENT_INFEASIBLE" | "STANDARD_FULFILMENT_INFEASIBLE";
            /** @enum {string} */
            state: "OPEN" | "RESOLVED";
            proofId: string | null;
            /** Format: date-time */
            openedAt: string;
        };
        Consent: {
            /** Format: date-time */
            agreedAt: string;
            /** @enum {string} */
            channel: "PHONE" | "WHATSAPP" | "IN_PERSON";
            reference: string;
        };
        ProductMedia: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            productId: string;
            /** @enum {string} */
            state: "STAGED" | "ATTACHED";
            byteCount: number;
            /** @enum {string} */
            mediaType: "image/jpeg" | "image/png" | "image/webp";
            /** Format: date-time */
            createdAt: string;
        };
        CapacityImpact: {
            /** Format: date */
            date: string;
            expectedVersion: number;
            occupiedUnits: number;
            usedUnits: number;
            canSave: boolean;
            affectedCount: number;
            impactToken: string;
            /** Format: date-time */
            expiresAt: string;
            items: {
                /** Format: uuid */
                orderId: string;
                orderNumber: string;
                /** @enum {string} */
                status: "AWAITING_FEE" | "AWAITING_CASH" | "PENDING_PROOF" | "PAYMENT_REVIEW" | "EXCEPTION" | "ACCEPTED" | "PREPARING" | "READY" | "HANDED_OFF" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED" | "NO_SHOW";
                /** @enum {string} */
                kind: "EXISTING_COMMITMENT" | "PENDING_RECHECK";
                units: number;
                promisedHandoffAt: string | null;
            }[];
            nextCursor: string | null;
        };
        OperatingPolicy: {
            version: number;
            /** @constant */
            timezone: "Asia/Kuala_Lumpur";
            openWeekdays: ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[];
            opensAt: string;
            closesAt: string;
            /** @constant */
            sameDaySubmitCutoff: "18:00";
            /** @constant */
            latestSameDayHandoff: "21:00";
            /** @constant */
            eventRollover: "22:00";
        };
        EventSchedule: {
            /** Format: date-time */
            eventStartAt: string;
            /** Format: date-time */
            eventEndAt: string;
            /** Format: date-time */
            setupReadyAt: string;
            /** Format: date-time */
            teardownAt: string;
        };
        AdminEvent: {
            /** Format: uuid */
            id: string;
            number: string;
            version: number;
            /** @enum {string} */
            status: "APPLIED" | "QUOTED" | "DEPOSIT_REVIEW" | "BOOKED" | "BALANCE_GRACE" | "PROCEEDING" | "EQUIPMENT_CHECK" | "ADDITIONAL_BILL" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "DECLINED" | "EXCEPTION" | "AWAITING_DEPOSIT";
            request: components["schemas"]["EventRequest"];
            quote: components["schemas"]["Quote"] | null;
            charges: components["schemas"]["Charge"][];
            allowedActions: string[];
            actualSetupAt: string | null;
            actualEndAt: string | null;
            actualTeardownAt: string | null;
            extraInvoices: {
                /** Format: uuid */
                chargeId: string;
                /** Format: date-time */
                dueAt: string;
                lines: {
                    reason: string;
                    amountMinor: number;
                    item: string;
                }[];
            }[];
            effectiveBalanceDueAt: string | null;
            effectiveBalanceGraceEndsAt: string | null;
            alternativeSchedule: components["schemas"]["EventSchedule"] | null;
            effectiveSchedule: components["schemas"]["EventSchedule"] | null;
            safeOutcome: string | null;
            merchantPlan: {
                resourceWindow: {
                    /** Format: date-time */
                    startAt: string;
                    /** Format: date-time */
                    endAt: string;
                };
                staffCount: number;
                assessmentNotes: string;
            } | null;
            equipmentLedger: {
                /** Format: uuid */
                equipmentId: string;
                taken: number;
                returned: number | null;
                damaged: number | null;
                lost: number | null;
                /** Format: date-time */
                takenAt: string;
                checkedAt: string | null;
            }[];
            recentHistory: {
                action: string;
                /** Format: date-time */
                at: string;
                safeReason: string | null;
            }[];
            balanceDeadlineRevision: number;
        };
        NoticeDetail: {
            /** Format: uuid */
            noticeId: string;
            /** @enum {string} */
            sourceType: "ORDER" | "EVENT" | "WORK";
            /** Format: uuid */
            sourceId: string;
            /** @enum {string} */
            recipientRole: "CUSTOMER" | "MERCHANT";
            milestone: string;
            /** @enum {string} */
            status: "PENDING" | "SENDING" | "DELIVERED" | "FAILED" | "UNKNOWN" | "RESOLVED";
            attempts: {
                attempt: number;
                /** @enum {string} */
                channel: "WHATSAPP" | "SMS" | "EMAIL";
                /** Format: date-time */
                at: string;
                /** @enum {string} */
                outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
                safeReason: string | null;
            }[];
            safeNextAction: string;
            resolvedAt: string | null;
        };
        /** @description Explicit confirmation that the customer has not sent a payment. This does not override recorded or disputed evidence. */
        ConfirmNoTransfer: {
            /** @constant */
            noTransferSent: true;
        };
    };
    responses: {
        /** @description Request failed (400) */
        Problem400: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (422) */
        Problem422: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (429) */
        Problem429: {
            headers: {
                /** @description Retry delay in seconds */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (503) */
        Problem503: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (401) */
        Problem401: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (403) */
        Problem403: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (404) */
        Problem404: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (409) */
        Problem409: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (413) */
        Problem413: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request failed (415) */
        Problem415: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        CsrfToken: string;
        Cursor: string;
        PageLimit: number;
        IdempotencyKey: string;
        ResourceVersion: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    startCustomerChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    phone: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Challenge"];
                };
            };
            400: components["responses"]["Problem400"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    verifyCustomerChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    challengeId: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Secure HttpOnly opaque same-origin session cookie */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["Problem400"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    startAdminSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    challengeId: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Secure HttpOnly opaque same-origin session cookie */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["Problem400"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    startAdminChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    verifiedContact: string;
                    /** @enum {string} */
                    purpose?: "SIGN_IN" | "RECOVERY";
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Challenge"];
                };
            };
            400: components["responses"]["Problem400"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    logoutSession: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            204: {
                headers: {
                    /** @description Expire session cookie */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    listCatalog: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
                category?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Product"][];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getCart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    setCartQuantity: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    quantity: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    evaluateAvailability: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    items: {
                        /** Format: uuid */
                        variantId: string;
                        quantity: number;
                    }[];
                    /** Format: date-time */
                    requestedHandoffAt: string;
                    /** @enum {string} */
                    fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        eligible: boolean;
                        alternatives: string[];
                        /** Format: date-time */
                        evaluatedAt: string;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    listOwnOrders: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Order"][];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    submitOrder: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitOrder"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getOwnOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    confirmDeliveryFee: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    feeVersion: number;
                    termsVersion: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    cancelOwnOrder: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmNoTransfer"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    submitChargeProof: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "X-File-Media-Type": "image/jpeg" | "image/png" | "application/pdf";
            };
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        /** @description At most 5 MiB. Complete validated registration, rather than upload start, adjudicates the deadline. */
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Proof"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    listMerchantWork: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
                kind?: "ORDER" | "EVENT" | "PROOF" | "NOTICE" | "PAYMENT_EXCEPTION";
                status?: string;
                serviceDate?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["WorkItem"][];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getMerchantOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrder"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    listMerchantProducts: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
                status?: "DRAFT" | "LISTED" | "UNLISTED" | "SUSPENDED" | "SOLD_OUT" | "ARCHIVED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Product"][];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    createProduct: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    category?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getMerchantProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    updateProduct: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                productId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    status: "DRAFT" | "LISTED" | "UNLISTED" | "SUSPENDED" | "SOLD_OUT" | "ARCHIVED";
                    variants: {
                        /** Format: uuid */
                        id?: string;
                        name: string;
                        flavour: string;
                        unitMinor: number;
                        prepMinutes: number;
                        available: boolean;
                    }[];
                    imageRefs: string[];
                    category?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    configureCapacity: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date */
                    date: string;
                    closed: boolean;
                    dayLimit: number;
                    productLimits: {
                        /** Format: uuid */
                        productId: string;
                        limit: number;
                    }[];
                    expectedVersion: number;
                    impactToken: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date */
                        date: string;
                        version: number;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    quoteDeliveryFee: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    feeMinor?: number;
                    /** Format: date-time */
                    handoffAt?: string;
                    serviceable: boolean;
                    reason: string;
                } & unknown;
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    changeStandardOrder: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "ACCEPT_CASH" | "REJECT" | "START_PREPARATION" | "MARK_READY" | "HANDOFF" | "COMPLETE" | "MARK_NO_SHOW" | "RECORD_INCIDENT" | "CANCEL" | "RECORD_DRIVER_ARRIVAL";
                    reason?: string;
                    /** Format: date-time */
                    handoffAt?: string;
                    /** Format: date-time */
                    driverArrivedAt?: string;
                    /** @enum {string} */
                    cancellationBasis?: "MERCHANT_UNABLE" | "CUSTOMER_POLICY" | "EXCEPTION";
                } & (unknown & unknown & unknown);
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    listPaymentProofs: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
            };
            header?: never;
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Proof"][];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getPaymentProofContent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                proofId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Cache-Control"?: "private, no-store";
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    confirmReceipt: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceiptCommand"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Charge"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    rejectProof: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                proofId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    /** @enum {string} */
                    decision: "REJECT_PROOF" | "REQUEST_SUPPLEMENT" | "REJECT_EVENT_DEPOSIT" | "REJECT_STANDARD_ORDER";
                    customerSafeReason: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Proof"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    recordRefund: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefundCommand"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Charge"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    reviewCheckout: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    items: {
                        /** Format: uuid */
                        variantId: string;
                        quantity: number;
                    }[];
                    /** Format: date-time */
                    requestedHandoffAt: string;
                    /** @enum {string} */
                    fulfilment: "PICKUP" | "MERCHANT_LALAMOVE" | "CUSTOMER_LALAMOVE";
                    cartVersion: number;
                    contactName: string;
                    phone: string;
                    address?: components["schemas"]["Address"];
                    /** Format: email */
                    notificationEmail?: string;
                } & unknown;
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutReview"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    reserveRefund: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    receiptId: string;
                    amountMinor: number;
                    expectedVersion: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        refundIntentId: string;
                        /** @enum {string} */
                        state: "RESERVED";
                        charge: components["schemas"]["Charge"];
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getChargeForReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        charge: components["schemas"]["Charge"];
                        proofs: components["schemas"]["Proof"][];
                        recentReceipts: {
                            /** Format: uuid */
                            id: string;
                            amountMinor: number;
                            /** Format: date-time */
                            occurredAt: string;
                        }[];
                        refundIntents: components["schemas"]["RefundIntent"][];
                        cases: components["schemas"]["SettlementCase"][];
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getCapacityCalendar: {
        parameters: {
            query: {
                from: string;
                to: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        days: {
                            /** Format: date */
                            date: string;
                            closed: boolean;
                            version: number;
                            maxUnits: number;
                            allocatedUnits: number;
                            productLimits: {
                                /** Format: uuid */
                                productId: string;
                                maxUnits: number;
                                allocatedUnits: number;
                            }[];
                            eventWindows: {
                                /** Format: uuid */
                                eventId: string;
                                /** Format: date-time */
                                startsAt: string;
                                /** Format: date-time */
                                endsAt: string;
                                /** @enum {string} */
                                status: "HELD" | "BOOKED" | "USED";
                            }[];
                        }[];
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getOwnCommandOutcome: {
        parameters: {
            query: {
                operation: string;
            };
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        resourceType: "ORDER" | "EVENT" | "PROOF" | "CART" | "CHARGE" | "PRODUCT" | "NOTICE";
                        /** Format: uuid */
                        resourceId: string;
                        /** Format: date-time */
                        completedAt: string;
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getCheckoutOutcome: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reviewId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutOutcome"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    abandonOrResolveCheckout: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                reviewId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutOutcome"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    openSettlementCase: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                chargeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    reason: "LATE_PROOF" | "AMOUNT_MISMATCH" | "TRANSFER_UNMATCHED" | "EVENT_FULFILMENT_INFEASIBLE" | "STANDARD_FULFILMENT_INFEASIBLE";
                    /** Format: uuid */
                    proofId?: string;
                    notes: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettlementCase"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    resolveSettlementCase: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettlementCase"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    reconcileRefundIntent: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                refundIntentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    outcome: "PAYOUT_UNCERTAIN" | "CONFIRMED_NOT_PAID";
                    reason: string;
                    expectedChargeVersion: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundIntent"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    rescheduleStandardOrder: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date-time */
                    proposedHandoffAt: string;
                    requiresNewProduction: boolean;
                    reason: string;
                    consent: components["schemas"]["Consent"];
                    /** @enum {string} */
                    recoveryKind: "RESCHEDULE" | "REDELIVERY";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    createDeliveryAdjustment: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["ResourceVersion"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amountMinor: number;
                    reason: string;
                    consent: components["schemas"]["Consent"];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Charge"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    uploadProductPhoto: {
        parameters: {
            query?: never;
            header: {
                "X-File-Media-Type": "image/jpeg" | "image/png" | "image/webp";
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                productId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMedia"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getMerchantProductPhoto: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: string;
                mediaId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Cache-Control"?: "private, no-store";
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                    "image/webp": string;
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getListedProductPhoto: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                mediaId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Cache-Control"?: "private, no-store";
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                    "image/webp": string;
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    previewCapacityImpact: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["PageLimit"];
            };
            header: {
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date */
                    date: string;
                    closed: boolean;
                    dayLimit: number;
                    productLimits: {
                        /** Format: uuid */
                        productId: string;
                        limit: number;
                    }[];
                    expectedVersion: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapacityImpact"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getOperatingPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatingPolicy"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    updateOperatingPolicy: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["ResourceVersion"];
                "X-CSRF-Token": components["parameters"]["CsrfToken"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    openWeekdays: ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[];
                    opensAt: string;
                    closesAt: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatingPolicy"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
    getListedProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current listed product */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            503: components["responses"]["Problem503"];
        };
    };
}
