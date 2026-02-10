-- ============================================
-- SEED DATA: Fornitori e Price List
-- ============================================

INSERT INTO price_lists (id, hotel_name, price_valid_date, source_file)
VALUES ('00000000-0000-0000-0000-000000000001', 'Sansepolcro Borgo Palace Hotel', '2025-04-05', 'Sansepolcro_Borgo_Palace_Hotel__2025_04_05.xlsx');

INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000001', 'Bindi', NULL, 'Bindi');
INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000002', 'Centrofarc S.p.A.', NULL, 'Centrofarc S.p.A.');
INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000003', 'MARR SPA', '215363', 'MARR SPA - Toscana');
INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000004', 'DORECA ITALIA S.P.A.', NULL, 'DORECA ITALIA SPA');
INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000005', 'DAC SPA', NULL, 'Dac Spa Flero');
INSERT INTO suppliers (id, name, account_number, depot) VALUES ('00000000-0000-0000-0001-000000000006', 'Forno d''Asolo', NULL, 'Forno d''Asolo');
