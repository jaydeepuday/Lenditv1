const { PrismaClient } = require('@prisma/client');
const http = require('http');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lendit_db?schema=public' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['query'] });

async function run() {
    console.log("=== DIAGNOSTIC SCRIPT START ===");

    // 1. Analyze images column in database
    const allItems = await prisma.item.findMany({ select: { images: true } });

    let totalImages = 0;
    let totalSize = 0;
    let maxSize = 0;
    let sizes = [];

    const isBase64 = (str) => {
        return str.startsWith('data:image') || (str.length > 100 && !str.startsWith('http'));
    };

    let sampleType = 'unknown';

    allItems.forEach(item => {
        totalImages += item.images.length;
        item.images.forEach(img => {
            const size = Buffer.byteLength(img, 'utf8');
            totalSize += size;
            sizes.push(size);
            if (size > maxSize) maxSize = size;
            if (sampleType === 'unknown' && size > 10) {
                sampleType = isBase64(img) ? 'Base64 Data' : (img.startsWith('http') ? 'URL' : 'Other String');
                console.log(`Sample prefix (first 50 chars): ${img.substring(0, 50)}`);
            }
        });
    });

    sizes.sort((a, b) => a - b);
    const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 0;
    const avgSize = totalImages > 0 ? totalSize / totalImages : 0;

    console.log(`\n--- DB IMAGE ANALYSIS ---`);
    console.log(`Total items sampled: ${allItems.length}`);
    console.log(`Storage Type: ${sampleType}`);
    console.log(`Total images: ${totalImages}`);
    console.log(`Per Image - Avg size: ${(avgSize / 1024).toFixed(2)} KB`);
    console.log(`Per Image - Median size: ${(medianSize / 1024).toFixed(2)} KB`);
    console.log(`Per Image - Max size: ${(maxSize / 1024).toFixed(2)} KB`);

    // 2. Measure Query timings (ignoring the first warm-up)
    await prisma.item.findMany({ take: 1 });

    const startFindMany = performance.now();
    await prisma.item.findMany({
        where: { isActive: true },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            title: true,
            description: true,
            category: true,
            pricePerHour: true,
            pricePerDay: true,
            maxHours: true,
            isAvailable: true,
            createdAt: true,
            images: true,
            owner: { select: { id: true, name: true, college: true } },
        }
    });
    const endFindMany = performance.now();

    const startCount = performance.now();
    await prisma.item.count({ where: { isActive: true } });
    const endCount = performance.now();

    console.log(`\n--- QUERY TIMINGS ---`);
    console.log(`findMany (limit 20): ${(endFindMany - startFindMany).toFixed(2)} ms`);
    console.log(`count: ${(endCount - startCount).toFixed(2)} ms`);

    // 3. Measure API Response Size
    console.log(`\n--- API PAYLOAD ANALYSIS ---`);
    http.get('http://localhost:3001/api/v1/items', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const payloadBytes = Buffer.byteLength(data, 'utf8');
            console.log(`HTTP Response Payload Size: ${(payloadBytes / 1024).toFixed(2)} KB`);

            try {
                const parsed = JSON.parse(data);
                const itemsCount = parsed.items ? parsed.items.length : 0;
                let imagesInResponseSize = 0;

                if (itemsCount > 0) {
                    parsed.items.forEach(i => {
                        if (i.images && i.images.length > 0) {
                            imagesInResponseSize += Buffer.byteLength(JSON.stringify(i.images), 'utf8');
                        }
                    });
                }

                console.log(`Items returned: ${itemsCount}`);
                console.log(`Size of strictly the 'images' array in response: ${(imagesInResponseSize / 1024).toFixed(2)} KB`);
            } catch (e) { }

            console.log("=== DIAGNOSTIC SCRIPT END ===");
            process.exit(0);
        });
    }).on('error', (err) => {
        console.error('Failed to fetch from API:', err.message);
        process.exit(1);
    });
}
run();
