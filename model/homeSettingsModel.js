import mongoose from 'mongoose';

const homeSettingsSchema = new mongoose.Schema({
    heroImage: {
        type: String,
        default: ''
    },
    leftCategoryImage: {
        type: String,
        default: ''
    },
    topCategoryImage: {
        type: String,
        default: ''
    },
    bottomCategoryImage: {
        type: String,
        default: ''
    },
    rightCategoryImage: {
        type: String,
        default: ''
    },
    leftCategory: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category'
        },
        name: String,
        description: String
    },
    topCategory: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category'
        },
        name: String,
        description: String
    },
    bottomCategory: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category'
        },
        name: String,
        description: String
    },
    rightCategory: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category'
        },
        name: String,
        description: String
    },
    handpickedProduct1: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        name: String,
        imagePath: String
    },
    handpickedProduct2: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        name: String,
        imagePath: String
    },
    handpickedProduct3: {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        name: String,
        imagePath: String
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const HomeSettings = mongoose.model('HomeSettings', homeSettingsSchema);

export default HomeSettings;