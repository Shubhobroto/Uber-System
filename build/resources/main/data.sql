INSERT INTO passengers (name, email, phone_number, created_at, updated_at)
VALUES ('Test Rider', 'rider@test.com', '9999999999', NOW(), NOW());

INSERT INTO drivers (id, name, email, phone_number, license_number, is_available, created_at, updated_at)
VALUES (1, 'Test Driver', 'driver@test.com', '8888888888', 'LIC123', true, NOW(), NOW());