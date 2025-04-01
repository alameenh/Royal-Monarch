import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['product', 'category'],
        required: true
    },
    discount: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    productIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    },
    varient: {
        type: Number,
        default: 0,
        min: 0
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Virtual to determine if it's a category or product offer
offerSchema.virtual('offerType').get(function () {
    return this.categoryId ? 'category' : 'product';
});


export default mongoose.model('Offer', offerSchema); 