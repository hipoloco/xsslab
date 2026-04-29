BEGIN;

TRUNCATE TABLE contact_messages, internal_users RESTART IDENTITY CASCADE;

INSERT INTO internal_users (username, password, role)
VALUES ('admin', 'admin123', 'admin');

INSERT INTO contact_messages (
    full_name,
    email,
    phone,
    message,
    status,
    processed_at
) VALUES
    (
        'Lucia Romero',
        'lucia.romero@example.com',
        '099100001',
        'Hola, quiero saber si tienen clase de prueba esta semana.',
        'new',
        NULL
    ),
    (
        'Matias Costa',
        'matias.costa@example.com',
        '099100002',
        'Me interesa el plan mensual y los horarios de la manana.',
        'new',
        NULL
    ),
    (
        'Carla Pereira',
        'carla.pereira@example.com',
        '099100003',
        'Gracias, ya recibi la informacion del plan inicial.',
        'processed',
        now()
    );

COMMIT;
