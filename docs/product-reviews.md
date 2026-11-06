# Verified-purchase reviews

Only the customer who owns the order through an authenticated account or a verified checkout email can review its products. The order must be marked **Paid** and **Delivered**, and the reviewed product must be present in its saved items. A review is limited to one per product per order; another purchase can receive its own review. The rating is required, while the title, review text, and photos are optional.

New review photos are stored outside `public/` in `data/review-photos/` by default. Set `REVIEW_UPLOAD_DIR` to a private, persistent directory when deploying to an ephemeral host. The server rejects a configured path inside the public web root. Pending, rejected, and hidden photos are available only to an authenticated admin; approved photos are served publicly. Existing review-photo URLs are also checked against their review's moderation status before being served.

Review records, photo metadata, and moderation audit events are stored in PostgreSQL. Schema initialization adds the review title, verified checkout email, hidden status, duplicate-purchase index, and audit table without replacing existing review content. Review submission writes its review row and photo metadata in one transaction. Permanent admin deletion records an audit event and removes new private photo files.

Public product reviews show only approved reviews, including the rating distribution, paginated review cards, and approved photos. Admin moderation supports approval, rejection, hiding, featuring, restoration, and permanent deletion, with optional moderation notes.
