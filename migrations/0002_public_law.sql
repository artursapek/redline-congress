-- Law number from Congress.gov's `laws` field, e.g. "Public Law 117-58".
-- NULL = not checked yet, '' = checked and not a law.
ALTER TABLE bills ADD COLUMN public_law TEXT;
