/**
 * @fileoverview Sequelize model definition for BuyShield protection records
 * Implements secure escrow-based transaction protection with photo verification
 * @version 1.0.0
 */

import { Model, DataTypes, Sequelize } from 'sequelize';
import { 
    IBuyShieldProtection, 
    BuyShieldStatus, 
    VerificationStatus 
} from '../../interfaces/buyshield.interface';

// Table name constant
const TABLE_NAME = 'buyshield_protections';

/**
 * Sequelize model class for BuyShield protection records
 * Implements enhanced security and validation for protected transactions
 */
export class BuyShieldModel extends Model<IBuyShieldProtection> implements IBuyShieldProtection {
    public id!: string;
    public transactionId!: string;
    public buyerId!: string;
    public sellerId!: string;
    public amount!: number;
    public status!: BuyShieldStatus;
    public verificationStatus!: VerificationStatus;
    public verificationPhoto!: string;
    public escrowId!: string;
    public expiresAt!: Date;
    public createdAt!: Date;
    public updatedAt!: Date;
}

/**
 * Initializes the BuyShield model schema definition
 * @param sequelize - Sequelize instance
 * @returns Initialized BuyShield model
 */
export function initModel(sequelize: Sequelize): typeof BuyShieldModel {
    BuyShieldModel.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            allowNull: false
        },
        transactionId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'transactions',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        buyerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        sellerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            validate: {
                min: 0.01,
                isDecimal: true
            }
        },
        status: {
            type: DataTypes.ENUM(...Object.values(BuyShieldStatus)),
            allowNull: false,
            defaultValue: BuyShieldStatus.ACTIVE,
            validate: {
                isIn: [Object.values(BuyShieldStatus)]
            }
        },
        verificationStatus: {
            type: DataTypes.ENUM(...Object.values(VerificationStatus)),
            allowNull: false,
            defaultValue: VerificationStatus.PENDING,
            validate: {
                isIn: [Object.values(VerificationStatus)]
            }
        },
        verificationPhoto: {
            type: DataTypes.STRING(2048),
            allowNull: true,
            validate: {
                isUrl: true,
                len: [0, 2048]
            }
        },
        escrowId: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: false,
            validate: {
                isDate: true,
                isAfterCreation(value: Date) {
                    if (value <= this.createdAt) {
                        throw new Error('Expiration date must be after creation date');
                    }
                }
            }
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        sequelize,
        tableName: TABLE_NAME,
        timestamps: true,
        indexes: [
            {
                name: 'buyshield_transaction_idx',
                fields: ['transactionId']
            },
            {
                name: 'buyshield_buyer_idx',
                fields: ['buyerId']
            },
            {
                name: 'buyshield_seller_idx',
                fields: ['sellerId']
            },
            {
                name: 'buyshield_status_idx',
                fields: ['status']
            },
            {
                name: 'buyshield_expiry_idx',
                fields: ['expiresAt']
            }
        ],
        hooks: {
            beforeCreate: (instance: BuyShieldModel) => {
                // Set expiration to 72 hours from creation
                const expiryDate = new Date();
                expiryDate.setHours(expiryDate.getHours() + 72);
                instance.expiresAt = expiryDate;
            },
            beforeUpdate: (instance: BuyShieldModel) => {
                // Validate status transitions
                if (instance.changed('status')) {
                    const validTransitions: { [key: string]: BuyShieldStatus[] } = {
                        [BuyShieldStatus.ACTIVE]: [
                            BuyShieldStatus.COMPLETED,
                            BuyShieldStatus.CANCELLED,
                            BuyShieldStatus.EXPIRED
                        ],
                        [BuyShieldStatus.COMPLETED]: [],
                        [BuyShieldStatus.CANCELLED]: [],
                        [BuyShieldStatus.EXPIRED]: []
                    };

                    const previousStatus = instance.previous('status');
                    const newStatus = instance.get('status');

                    if (!validTransitions[previousStatus].includes(newStatus)) {
                        throw new Error(`Invalid status transition from ${previousStatus} to ${newStatus}`);
                    }
                }
            }
        }
    });

    return BuyShieldModel;
}