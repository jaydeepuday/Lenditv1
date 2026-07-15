-- Hard normalization for beta stabilization
-- Since the platform only supports Woxsen University currently,
-- we normalize ALL existing records to ensure zero data fragmentation.
UPDATE users
SET college = 'Woxsen University';
