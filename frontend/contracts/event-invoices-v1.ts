// Generated from the event invoice extension.
export interface paths {
    "/admin/invoice-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getInvoiceTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/invoice-template/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["saveInvoiceTemplateDraft"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/invoice-template/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["publishInvoiceTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/invoice-template/preview/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["previewInvoiceTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{eventId}/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
            };
            cookie?: never;
        };
        get: operations["listOwnEventInvoices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/events/{eventId}/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
            };
            cookie?: never;
        };
        get: operations["listMerchantEventInvoices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/events/{eventId}/invoices/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["issueExistingEventInvoice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{eventId}/invoices/{kind}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        get: operations["downloadOwnEventInvoice"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/events/{eventId}/invoices/{kind}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        get: operations["downloadMerchantEventInvoice"];
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
        /** @enum {string} */
        InvoiceSection: "header" | "billing" | "items" | "payment" | "footer";
        /** @enum {string} */
        InvoiceKind: "booking" | "extras";
        InvoiceLogo: {
            /** @enum {string} */
            mediaType: "image/png" | "image/jpeg" | "image/webp";
            data: string;
        };
        InvoiceTemplate: {
            order: components["schemas"]["InvoiceSection"][];
            header: {
                title: string;
                issuer: string;
                issuerDetails: string;
                accent: string;
                logo: components["schemas"]["InvoiceLogo"] | null;
            };
            billing: {
                billedTo: string;
                venue: string;
            };
            items: {
                description: string;
                quantity: string;
                unitPrice: string;
                amount: string;
                /** @enum {string} */
                style: "tinted" | "plain" | "striped";
            };
            payment: {
                heading: string;
                instructions: string;
            };
            footer: {
                visible: boolean;
                text: string;
            };
        };
        TemplateState: {
            version: number;
            draft: components["schemas"]["InvoiceTemplate"];
            publishedRevision: number;
            hasUnpublishedChanges: boolean;
        };
        InvoiceReference: {
            kind: components["schemas"]["InvoiceKind"];
            number: string;
        };
        EventInvoices: {
            items: components["schemas"]["InvoiceReference"][];
            canIssue?: components["schemas"]["InvoiceKind"][];
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
        /** @description Request failed (422) */
        Problem422: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Other failures use the shared problem envelope, including temporary dependency failures and unexpected errors. */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Merchant template state */
        Template: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["TemplateState"];
            };
        };
        /** @description Issued invoices with merchant-only issuance eligibility */
        InvoiceList: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["EventInvoices"];
            };
        };
        /** @description Issued PDF attachment */
        InvoicePdf: {
            headers: {
                "Content-Disposition"?: string;
                "Cache-Control"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/pdf": string;
            };
        };
    };
    parameters: {
        EventId: string;
        Kind: components["schemas"]["InvoiceKind"];
        Csrf: string;
        Version: string;
    };
    requestBodies: {
        Template: {
            content: {
                "application/json": {
                    template: components["schemas"]["InvoiceTemplate"];
                };
            };
        };
    };
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getInvoiceTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["Template"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            default: components["responses"]["Problem"];
        };
    };
    saveInvoiceTemplateDraft: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["Csrf"];
                "If-Match": components["parameters"]["Version"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["Template"];
        responses: {
            200: components["responses"]["Template"];
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            409: components["responses"]["Problem409"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    publishInvoiceTemplate: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["Csrf"];
                "If-Match": components["parameters"]["Version"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["Template"];
        responses: {
            200: components["responses"]["Template"];
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            409: components["responses"]["Problem409"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    previewInvoiceTemplate: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["Csrf"];
            };
            path: {
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        requestBody: components["requestBodies"]["Template"];
        responses: {
            /** @description Rendered pages of the sample PDF */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        pages: string[];
                    };
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    listOwnEventInvoices: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["InvoiceList"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    listMerchantEventInvoices: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["InvoiceList"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    issueExistingEventInvoice: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["Csrf"];
            };
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stable invoice reference */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvoiceReference"];
                };
            };
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            409: components["responses"]["Problem409"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    downloadOwnEventInvoice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["InvoicePdf"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
    downloadMerchantEventInvoice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
                kind: components["parameters"]["Kind"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["InvoicePdf"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            422: components["responses"]["Problem422"];
            default: components["responses"]["Problem"];
        };
    };
}
