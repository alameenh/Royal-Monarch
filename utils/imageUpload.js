import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

export const uploadImage = async (imageData, options = {}) => {
    try {
        if (!imageData) {
            throw new Error('No image data provided');
        }

        let buffer;
        let format = 'jpg';

        // Handle both Buffer and base64 string inputs
        if (Buffer.isBuffer(imageData)) {
            buffer = imageData;
        } else if (typeof imageData === 'string') {
            // Remove the data URL prefix and get the format
            const matches = imageData.match(/^data:image\/(\w+);base64,/);
            format = matches ? matches[1] : 'jpg';
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            
            // Create a buffer from base64
            buffer = Buffer.from(base64Data, 'base64');
        } else {
            throw new Error('Invalid image data type');
        }

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const filename = `${timestamp}-${randomString}.${format}`;
        const filepath = path.join(uploadsDir, filename);

        // Process image based on type with high quality settings
        let processedImage;
        if (options.type === 'hero') {
            // Hero image: 1920x1080 with high quality
            processedImage = await sharp(buffer)
                .resize(options.dimensions?.width || 1920, options.dimensions?.height || 1080, {
                    fit: 'cover',
                    position: 'center',
                    withoutEnlargement: true
                })
                .jpeg({ 
                    quality: 100,
                    chromaSubsampling: '4:4:4'
                })
                .toBuffer();
        } else if (options.type === 'category') {
            // Category image with high quality
            processedImage = await sharp(buffer)
                .resize(options.dimensions?.width || 387, options.dimensions?.height || 215, {
                    fit: 'cover',
                    position: 'center',
                    withoutEnlargement: true
                })
                .jpeg({ 
                    quality: 100,
                    chromaSubsampling: '4:4:4'
                })
                .toBuffer();
        } else {
            processedImage = buffer;
        }

        // Save the processed file
        await fs.promises.writeFile(filepath, processedImage);

        // Return the URL path
        return `/uploads/${filename}`;
    } catch (error) {
        console.error('Error uploading image:', error);
        throw new Error(`Failed to upload image: ${error.message}`);
    }
};

export const deleteImage = async (imageUrl) => {
    try {
        if (!imageUrl) return true;

        // Extract filename from URL and remove the /uploads/ prefix
        const filename = path.basename(imageUrl);
        const filepath = path.join(uploadsDir, filename);

        // Check if file exists
        if (fs.existsSync(filepath)) {
            await fs.promises.unlink(filepath);
            console.log(`Successfully deleted image: ${filepath}`);
        } else {
            console.log(`Image not found: ${filepath}`);
        }

        return true;
    } catch (error) {
        console.error('Error deleting image:', error);
        throw error;
    }
}; 