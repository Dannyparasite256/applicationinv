import { z } from 'zod';

/** Accept empty string from forms; store as null */
const optionalEmail = z
  .union([z.string().email('Enter a valid email'), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => (v == null || v === '' ? null : v));

const optionalText = z
  .union([z.string(), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => (v == null || v === '' ? null : v));

export const createCustomerSchema = z
  .object({
    type: z.enum(['individual', 'business']).default('individual'),
    firstName: optionalText,
    lastName: optionalText,
    businessName: optionalText,
    email: optionalEmail,
    phone: optionalText,
    address: optionalText,
    city: optionalText,
    country: optionalText,
    creditLimit: z.coerce.number().min(0).default(0),
    notes: optionalText,
  })
  .superRefine((val, ctx) => {
    const hasIdentity =
      Boolean(val.firstName?.trim()) ||
      Boolean(val.lastName?.trim()) ||
      Boolean(val.businessName?.trim()) ||
      Boolean(val.phone?.trim()) ||
      Boolean(val.email?.trim());
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a name, phone, or email for the customer',
        path: ['firstName'],
      });
    }
  });

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  contactPerson: optionalText,
  email: optionalEmail,
  phone: optionalText,
  address: optionalText,
  paymentTerms: optionalText,
  notes: optionalText,
});

export const createPatientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.coerce.date().optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).default('UNKNOWN'),
  phone: optionalText,
  email: optionalEmail,
  address: optionalText,
  bloodGroup: optionalText,
  allergies: z.array(z.string()).optional(),
  type: z.enum(['OUTPATIENT', 'INPATIENT', 'EMERGENCY']).default('OUTPATIENT'),
  insuranceProvider: optionalText,
  insuranceNo: optionalText,
});
