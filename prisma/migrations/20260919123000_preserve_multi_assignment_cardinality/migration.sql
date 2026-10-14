-- Existing notification and authentication behavior supports multiple role
-- assignments per identity. Preserve that cardinality while each assignment
-- remains scope-safe and independently addressable by userRoleId.
DROP INDEX "uq_user_role_single_context";
