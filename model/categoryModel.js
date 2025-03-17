import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category name is required'],
        trim: true,
        minlength: [3, 'Category name must be at least 3 characters long'],
        unique: true
    },
    description: {
        type: String,
        required: [true, 'Category description is required'],
        trim: true,
        minlength: [10, 'Category description must be at least 10 characters long']
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active'
    }
}, { timestamps: true });

// Add a pre-save middleware to ensure trimming
categorySchema.pre('save', function(next) {
    if (this.name) this.name = this.name.trim();
    if (this.description) this.description = this.description.trim();
    next();
});

export default mongoose.model('Category', categorySchema);