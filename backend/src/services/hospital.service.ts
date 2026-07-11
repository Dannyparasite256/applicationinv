import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { generateSku, generateDocNo } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';
import { Gender, PatientType, Prisma } from '@prisma/client';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listPatients(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const where: Prisma.PatientWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.search
      ? {
          OR: [
            { firstName: { contains: params.search, mode: 'insensitive' } },
            { lastName: { contains: params.search, mode: 'insensitive' } },
            { patientNo: { contains: params.search, mode: 'insensitive' } },
            { phone: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
    }),
  ]);
  return { data, total };
}

export async function createPatient(
  companyId: string | null | undefined,
  data: {
    firstName: string;
    lastName: string;
    dateOfBirth?: Date | null;
    gender?: Gender;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    bloodGroup?: string | null;
    allergies?: string[];
    type?: PatientType;
    insuranceProvider?: string | null;
    insuranceNo?: string | null;
  }
) {
  const cid = requireCompany(companyId);
  const count = await prisma.patient.count({ where: { companyId: cid } });
  return prisma.patient.create({
    data: {
      companyId: cid,
      patientNo: generateSku('PAT', count + 1),
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender || 'UNKNOWN',
      phone: data.phone,
      email: data.email,
      address: data.address,
      bloodGroup: data.bloodGroup,
      allergies: data.allergies || [],
      type: data.type || 'OUTPATIENT',
      insuranceProvider: data.insuranceProvider,
      insuranceNo: data.insuranceNo,
    },
  });
}

export async function getPatient(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const patient = await prisma.patient.findFirst({
    where: { id, companyId: cid, deletedAt: null },
    include: {
      appointments: { take: 10, orderBy: { scheduledAt: 'desc' } },
      consultations: { take: 10, orderBy: { createdAt: 'desc' } },
      prescriptions: { take: 10, orderBy: { prescribedAt: 'desc' }, include: { items: true } },
      vitalSigns: { take: 5, orderBy: { recordedAt: 'desc' } },
      labOrders: { take: 5, orderBy: { orderedAt: 'desc' }, include: { tests: true } },
      admissions: { take: 5, orderBy: { admittedAt: 'desc' } },
    },
  });
  if (!patient) throw new NotFoundError('Patient');
  return patient;
}

export async function createAppointment(
  companyId: string | null | undefined,
  data: {
    patientId: string;
    doctorId?: string;
    departmentId?: string;
    scheduledAt: Date;
    reason?: string;
  }
) {
  const cid = requireCompany(companyId);
  const patient = await prisma.patient.findFirst({ where: { id: data.patientId, companyId: cid } });
  if (!patient) throw new NotFoundError('Patient');
  const count = await prisma.appointment.count();
  const dayStart = new Date(data.scheduledAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(data.scheduledAt);
  dayEnd.setHours(23, 59, 59, 999);
  const queueCount = await prisma.appointment.count({
    where: { scheduledAt: { gte: dayStart, lte: dayEnd }, doctorId: data.doctorId },
  });

  return prisma.appointment.create({
    data: {
      patientId: data.patientId,
      doctorId: data.doctorId,
      departmentId: data.departmentId,
      appointmentNo: generateDocNo('APT', count + 1),
      scheduledAt: data.scheduledAt,
      reason: data.reason,
      queueNumber: queueCount + 1,
      status: 'SCHEDULED',
    },
  });
}

export async function createPrescription(
  companyId: string | null | undefined,
  data: {
    patientId: string;
    doctorId?: string;
    notes?: string;
    items: Array<{
      productId?: string;
      drugName: string;
      dosage?: string;
      frequency?: string;
      duration?: string;
      quantity: number;
      instructions?: string;
    }>;
  }
) {
  const cid = requireCompany(companyId);
  const patient = await prisma.patient.findFirst({ where: { id: data.patientId, companyId: cid } });
  if (!patient) throw new NotFoundError('Patient');
  const count = await prisma.prescription.count();
  return prisma.prescription.create({
    data: {
      patientId: data.patientId,
      doctorId: data.doctorId,
      prescriptionNo: generateDocNo('RX', count + 1),
      notes: data.notes,
      status: 'PENDING',
      items: {
        create: data.items.map((i) => ({
          productId: i.productId,
          drugName: i.drugName,
          dosage: i.dosage,
          frequency: i.frequency,
          duration: i.duration,
          quantity: i.quantity,
          instructions: i.instructions,
        })),
      },
    },
    include: { items: true },
  });
}

export async function listLabOrders(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const where = {
    patient: { companyId: cid },
  };
  const [total, data] = await Promise.all([
    prisma.labOrder.count({ where }),
    prisma.labOrder.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: { orderedAt: 'desc' },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNo: true } },
        tests: true,
      },
    }),
  ]);
  return { data, total };
}

export async function createLabOrder(
  companyId: string | null | undefined,
  data: {
    patientId: string;
    orderedBy?: string;
    priority?: string;
    notes?: string;
    tests: Array<{ testCode: string; testName: string }>;
  }
) {
  const cid = requireCompany(companyId);
  const patient = await prisma.patient.findFirst({ where: { id: data.patientId, companyId: cid } });
  if (!patient) throw new NotFoundError('Patient');
  const count = await prisma.labOrder.count();
  return prisma.labOrder.create({
    data: {
      patientId: data.patientId,
      orderNo: generateDocNo('LAB', count + 1),
      orderedBy: data.orderedBy,
      priority: data.priority || 'routine',
      notes: data.notes,
      status: 'ORDERED',
      tests: {
        create: data.tests.map((t) => ({
          testCode: t.testCode,
          testName: t.testName,
        })),
      },
    },
    include: { tests: true },
  });
}
