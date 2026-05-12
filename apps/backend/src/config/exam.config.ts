export const EXAM_CONFIG = {
    isExamMode: true,
    // Start and End dates for the active "EXAM_PASS" window
    examStart: '2024-05-10T08:00:00.000Z',
    examEnd: '2024-05-20T18:00:00.000Z',
    // Allowed hour rent duration for QUICK
    quickRentMaxHours: 4,
    // Pricing configuration (fixed override prices)
    prices: {
        QUICK: 50,
        EXAM_PASS: 150,
    },
};
