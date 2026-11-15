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
        };
    };
}
