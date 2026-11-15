"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import {
  photoPath,
  productPagePath,
  statusNames,
  type Product,
  type ProductStatus,
} from "./merchant-catalog-model";

const currency = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});
const statusHints: Record<ProductStatus, string> = {
  DRAFT: "Finish setup before listing.",
  LISTED: "Listed in your shop.",
  UNLISTED: "Hidden from customers.",
  SUSPENDED: "Listing paused.",
  SOLD_OUT: "Currently unavailable.",
  ARCHIVED: "Archived product.",
};

function ProductCover({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  const cover = product.imageRefs[0];
  return (
    <div className="catalogue-product-cover">
      {cover && !failed ? (
        <img
          src={photoPath(product.id, cover)}
          alt={product.name}
          loading="lazy"
          decoding="async"
          width={600}
          height={375}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="catalogue-photo-placeholder">
          <Icon name="cake" size={34} />
          <span>{cover ? "Photo unavailable" : "Add a product photo"}</span>
        </div>
      )}
      <span className="catalogue-product-status" data-status={product.status}>
        {statusNames[product.status]}
      </span>
      {product.imageRefs.length > 0 && (
        <span className="catalogue-photo-count">
          {product.imageRefs.length}{" "}
          {product.imageRefs.length === 1 ? "photo" : "photos"}
        </span>
      )}
    </div>
  );
}

export function MerchantProductCard({ product }: { product: Product }) {
  const prices = product.variants.map((variant) => variant.unitMinor);
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const enabled = product.variants.filter(
    (variant) => variant.available,
  ).length;
  return (
    <li className="catalogue-product-card">
      <ProductCover
        key={product.id + ":" + product.imageRefs[0]}
        product={product}
      />
      <div className="catalogue-product-body">
        <p className="catalogue-product-category">
          {product.category || "Uncategorized"}
        </p>
        <h3>{product.name}</h3>
        <p className="catalogue-status-hint">{statusHints[product.status]}</p>
        <dl className="catalogue-product-facts">
          <div>
            <dt>Variant {prices.length === 1 ? "price" : "prices"}</dt>
            <dd>
              {prices.length
                ? currency.format(min / 100) +
                  (min !== max ? " – " + currency.format(max / 100) : "")
                : "Not set"}
            </dd>
          </div>
          <div>
            <dt>Enabled variants</dt>
            <dd>
              {enabled} <span>of {product.variants.length}</span>
            </dd>
          </div>
        </dl>
        <Link
          className="button button-secondary"
          href={productPagePath(product.id)}
          prefetch={false}
          aria-label={`${product.status === "ARCHIVED" ? "View" : "Edit"} ${product.name}`}
        >
          <Icon
            name={product.status === "ARCHIVED" ? "eye" : "edit"}
            size={16}
          />
          {product.status === "ARCHIVED" ? "View product" : "Edit product"}
        </Link>
      </div>
    </li>
  );
}
