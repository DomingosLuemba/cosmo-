-- Webhook signing secrets must be recoverable by the service, because the
-- service has to sign every delivery with them. Storing only a hash — correct
-- for an API key, which is only ever compared — makes signing impossible.
--
-- They are therefore stored encrypted with a key the service holds, not
-- hashed. The hash column stays: it identifies which secret is current without
-- decrypting anything, which is what a rotation audit needs.
ALTER TABLE webhook_endpoints
    ADD COLUMN IF NOT EXISTS secret_encrypted TEXT;

COMMENT ON COLUMN webhook_endpoints.secret_hash IS
    'SHA-256 of the signing secret, for identification and rotation audit only.';
COMMENT ON COLUMN webhook_endpoints.secret_encrypted IS
    'AES-256-GCM encrypted signing secret. The service decrypts it to sign each delivery.';
