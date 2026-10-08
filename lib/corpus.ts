const HRC_GUIDE = "https://cdn.sanity.io/files/tvxlqs0f/dev/45135ff2f793aa677b99492c7a0df88cacfdc4d9.pdf";
const EMP_NZ = "https://www.employment.govt.nz/starting-employment/hiring/discrimination-when-hiring/";
const HRA = "https://www.legislation.govt.nz/act/public/1993/82/en/2025-11-27.pdf";

export const SOURCES = {
  hra_s21: { title: "Human Rights Act 1993, s21 (prohibited grounds)", url: HRA,
    summary: "The 13 grounds: sex (incl. pregnancy), marital status, religious belief, ethical belief, colour, race, ethnic or national origins (incl. nationality, citizenship), disability, age (16+), political opinion, employment status, family status, sexual orientation." },
  hra_s22_23: { title: "Human Rights Act 1993, ss22-23 (hiring and applicant questions)", url: HRA,
    summary: "Unlawful to refuse to employ, or offer worse terms, because of a prohibited ground, or to ask an applicant anything that signals an intention to do that." },
  empnz_hiring: { title: "Employment NZ: discrimination when hiring", url: EMP_NZ,
    summary: "The Act covers ads, application forms, interviews and offers. Applicants can complain to the Human Rights Commission." },
  ground_family: { title: "HRC A-Z Pre-Employment Guide (family status)", url: HRC_GUIDE,
    summary: "Don't ask about children, childcare, caring for dependants or relatives. Ask whether they can work the hours the role needs." },
  ground_sex: { title: "HRC A-Z Pre-Employment Guide (sex, pregnancy)", url: HRC_GUIDE,
    summary: "Don't ask about pregnancy or plans to have children. Describe the role's demands and ask if they can meet them." },
  ground_marital: { title: "HRC A-Z Pre-Employment Guide (marital status)", url: HRC_GUIDE,
    summary: "Don't ask whether they're married, single or partnered, or about a partner's job." },
  ground_age: { title: "Employment NZ: discrimination when hiring (age)", url: EMP_NZ,
    summary: "Don't ask age, date of birth, or proxies like the year they left school. Ask about the experience, licence or skills the job needs." },
  ground_origin: { title: "HRC A-Z Pre-Employment Guide (ethnic or national origin)", url: HRC_GUIDE,
    summary: "Don't ask where they're from, nationality, citizenship, first language, about their accent, or for 'New Zealand experience'. Ask if they're entitled to work in NZ and about the communication the job needs." },
  ground_race: { title: "HRC A-Z Pre-Employment Guide (race, colour)", url: HRC_GUIDE,
    summary: "Don't ask about race, colour or ethnicity in an interview." },
  ground_religion: { title: "Employment NZ: discrimination when hiring (religion)", url: EMP_NZ,
    summary: "Don't ask about religion, beliefs or practices. Ask whether they can work the rostered days and times." },
  ground_disability: { title: "HRC A-Z Pre-Employment Guide (disability, health)", url: HRC_GUIDE,
    summary: "Don't ask general health, injury, ACC or disability questions. Describe the job's real requirements and ask if they can do them, with or without reasonable adjustments." },
  ground_employment_status: { title: "HRC A-Z Pre-Employment Guide (employment status)", url: HRC_GUIDE,
    summary: "Don't ask whether they're unemployed, on a benefit or receiving ACC payments." },
  ground_political: { title: "Employment NZ: discrimination when hiring (political opinion)", url: EMP_NZ,
    summary: "Don't ask about political views, voting or party support." },
  ground_orientation: { title: "Employment NZ: discrimination when hiring (sexual orientation)", url: EMP_NZ,
    summary: "Don't ask about sexual orientation or who they date." },
} as const;

export type SourceId = keyof typeof SOURCES;
export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];
export const sourcesForPrompt = () =>
  SOURCE_IDS.map((id) => `${id}: ${SOURCES[id].summary}`).join("\n");
