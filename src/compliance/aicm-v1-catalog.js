/**
 * CSA AI Controls Matrix (AICM) v1 — control catalog
 *
 * Source: CSA AICM v1 (243 controls / 18 domains) — public CSV mirror at
 *   https://github.com/rocklambros/TRACT (opencre_export/CSA_AI_Controls_Matrix.csv)
 *   (OpenCRE-exported subset of CSA AICM v1 control IDs and descriptions)
 *
 * This file ships a verified subset of 184 control IDs across all 18 AICM domains.
 * The remaining ~59 control IDs in the full 243 are not yet mapped to OpenCRE hubs;
 * they will be added in a subsequent release once the public CSV is updated or CSA
 * publishes a non-gated mirror of the full spreadsheet.
 *
 * AICM domain codes (18 total, per CSA AICM v1 spreadsheet):
 *   A&A  Audit & Accountability
 *   AIS  Application & Interface Security
 *   BCR  Business Continuity Mgmt & Operational Resilience
 *   CCC  Change Control & Configuration Mgmt
 *   CEK  Cryptography, Encryption & Key Mgmt
 *   DCS  Datacenter Security
 *   DSP  Data Security & Privacy
 *   GRC  Governance, Risk Mgmt & Compliance
 *   HRS  Human Resources Security
 *   I&S  Interoperability & Sharing
 *   IAM  Identity & Access Mgmt
 *   IPY  Interoperability & Portability
 *   LOG  Logging & Monitoring
 *   MDS  Model Security (AI-specific, new in AICM v1)
 *   SEF  Security Incident E-Response & Mgmt
 *   STA  Supply Chain Mgmt, Transparency & Accountability
 *   TVM  Threat & Vulnerability Mgmt
 *   UEM  Universal Endpoint Mgmt
 *
 * Regenerate from /tmp/aicm-fetch/CSA_AI_Controls_Matrix.csv when the upstream is
 * refreshed — see scripts/regenerate-aicm-catalog.js for the source-of-truth conversion.
 */

const AICM_V1_DOMAINS = {
  // A&A
  'A&A': {
    'A&A-01': { name: 'Audit and Assurance Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain audit and assurance policies and procedures and standards. Review and update the policies and procedures at least annually or upon significant changes.' },
    'A&A-02': { name: 'Independent Assessments', description: 'Conduct independent audit and assurance assessments according to relevant standards at least annually.' },
    'A&A-03': { name: 'Risk Based Planning Assessment', description: 'Perform independent audit and assurance assessments in response to significant changes or emerging risks and according to risk-based plans and policies.' },
    'A&A-04': { name: 'Requirements Compliance', description: 'Verify compliance with all relevant standards, regulations, legal/contractual, and statutory requirements applicable to the audit.' },
    'A&A-05': { name: 'Audit Management Process', description: 'Define and implement an Audit Management process aligned with global auditing standards, to support audit planning, risk analysis, security control assessment, conclusion, remediation schedules, report generation, and review of past reports and supporting evidence.' },
    'A&A-06': { name: 'Remediation', description: 'Establish, document, approve, communicate, apply, evaluate and maintain a risk-based corrective action plan to remediate audit findings, regularly review and report remediation status to relevant stakeholders.' },
  },
  // AIS
  'AIS': {
    'AIS-02': { name: 'Application Security Baseline Requirements', description: 'Establish, document and maintain baseline requirements for securing applications.\"' },
    'AIS-03': { name: 'Application Security Metrics', description: 'Define and implement technical and operational metrics in alignment with business objectives, security requirements, and compliance obligations.' },
    'AIS-05': { name: 'Application Security Testing', description: 'Implement a testing strategy, including criteria for acceptance of new information systems, upgrades and new versions, which provides application security assurance and maintains compliance while meeting organizational delivery goals. Automate when applicable and possible.' },
    'AIS-06': { name: 'Secure Application Deployment', description: 'Establish and implement strategies and capabilities for secure, standardized, and compliant application deployment. Automate where possible.' },
    'AIS-07': { name: 'Application Vulnerability Remediation', description: 'Define and implement a process to remediate application security vulnerabilities, automating remediation when possible.' },
    'AIS-08': { name: 'Input Validation', description: 'Validate, filter, modify or block, as necessary, input against adversarial patterns, failure patterns and unwanted behaviour according to organisational policies and applicable laws and regulations.' },
    'AIS-09': { name: 'Output Validation', description: 'Validate, filter, modify or block, as necessary, output against adversarial patterns, failure patterns and unwanted behaviour according to organisational policies and applicable laws and regulations.' },
    'AIS-10': { name: 'API Security', description: 'Define and implement processes, procedures, and technical measures to secure APIs. Review and update for any improvements at least annually or after significant system changes.' },
    'AIS-11': { name: 'Agents Security Boundaries', description: 'Establish security boundaries for agents.' },
    'AIS-14': { name: 'AI Cache Protection', description: 'Implement security measures to protect caches in GenAI systems and services.' },
    'AIS-15': { name: 'Prompt Differentation', description: 'Implement mechanisms enabling the model to clearly distinguish user-provided input instructions from data and system instructions (e.g., system prompts).' },
  },
  // BCR
  'BCR': {
    'BCR-01': { name: 'Business Continuity Management Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain business continuity management and operational resilience policies and procedures. Review and update the policies and procedures at least annually, or when significant changes occur that could impact risk exposure.' },
    'BCR-02': { name: 'Risk Assessment and Impact Analysis', description: 'Determine the impact of business disruptions and risks to establish criteria for developing business continuity and operational resilience strategies and capabilities. Review and update the risk assessment and impact analysis at least annually or upon significant changes.' },
    'BCR-03': { name: 'Business Continuity Strategy', description: 'Establish strategies to reduce the impact of business disruptions, and improve resiliency and recovery from business disruptions.' },
    'BCR-04': { name: 'Business Continuity Planning', description: 'Establish, document, approve, communicate, apply, evaluate and maintain a business continuity plan based on the results of the operational resilience strategies and capabilities.' },
    'BCR-05': { name: 'Documentation', description: 'Develop, identify, and acquire documentation, both internally and from external parties, that is relevant to support the business continuity and operational resilience programs. Make the documentation available to authorized stakeholders and review at least annually or upon significant changes.' },
    'BCR-06': { name: 'Business Continuity Exercises', description: 'Follow a structured approach to evaluate the effectiveness of the business continuity and operational resilience plans at planned intervals or upon significant changes.' },
    'BCR-07': { name: 'Communication', description: 'Establish and maintain communication channels with all relevant stakeholders in the course of business continuity and resilience procedures.' },
    'BCR-08': { name: 'Backup', description: 'Periodically perform backups. Ensure the confidentiality, integrity and availability of the backup, and verify restoration from backup for resiliency.' },
    'BCR-09': { name: 'Disaster Response Plan', description: 'Establish, document, approve, communicate, apply, evaluate and maintain a disaster response plan to recover from natural and man-made disasters. Update the plan at least annually or upon significant changes.' },
    'BCR-11': { name: 'Equipment Redundancy', description: 'Supplement business-critical equipment with both locally redundant and geographically dispersed equipment located at a reasonable minimum distance in accordance with applicable industry standards.' },
  },
  // CCC
  'CCC': {
    'CCC-01': { name: 'Change Management Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for managing the risks associated with applying changes to assets owned, controlled or used by the organization. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'CCC-03': { name: 'Change Management Technology', description: 'Implement a change management procedure to manage the risks associated with applying changes to assets owned, controlled or used by the organization.' },
    'CCC-04': { name: 'Change Authorization', description: 'Implement and enforce a procedure to authorize addition, removal, update, and management of assets, owned, controlled or used by the organization.' },
    'CCC-05': { name: 'Change Agreements', description: 'Include provisions limiting changes directly impacting customer owned environments/tenants to explicitly authorized requests within service level agreements.' },
    'CCC-06': { name: 'Change Management Baseline', description: 'Establish change management baselines for all relevant authorized changes on organization assets. Review and update the change management baseline at least annually or upon significant changes.' },
    'CCC-07': { name: 'Detection of Baseline Deviation', description: 'Implement detection measures with proactive notification in case of changes deviating from the established baseline.' },
    'CCC-08': { name: 'Exception Management', description: 'Implement a procedure for the management of exceptions, including emergencies, in the change and configuration process. Align the procedure with the requirements of GRC-04: Policy Exception Process.' },
  },
  // CEK
  'CEK': {
    'CEK-01': { name: 'Encryption and Key Management Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for Cryptography, Encryption and Key Management. Review and update the policies and procedures at least annually or upon significant changes.' },
    'CEK-02': { name: 'CEK Roles and Responsibilities', description: 'Define and implement cryptographic, encryption and key management roles and responsibilities.' },
    'CEK-03': { name: 'Data Encryption', description: 'Provide data protection at-rest, in-transit and, where applicable, in-use by using cryptographic libraries certified to approved standards.' },
    'CEK-05': { name: 'Encryption Change Management', description: 'Establish a standard change management procedure, to accommodate changes from internal and external sources, for review, approval, implementation and communication of cryptographic, encryption and key management technology changes.' },
    'CEK-06': { name: 'Encryption Change Cost Benefit Analysis', description: 'Manage and adopt changes to cryptography-, encryption-, and key management-related systems (including policies and procedures) that fully account for downstream effects of proposed changes, including residual risk, cost, and benefits analysis.' },
    'CEK-07': { name: 'Encryption Risk Management', description: 'Establish and maintain an encryption and key management risk program that includes provisions for risk assessment, risk treatment, risk context, monitoring, and feedback.' },
    'CEK-08': { name: 'Customer Key Management Capability', description: 'Providers must provide the capability for customers to manage their own data encryption keys.' },
    'CEK-09': { name: 'Encryption and Key Management Audit', description: 'Audit encryption and key management systems, policies, and processes with a frequency that is proportional to the risk exposure of the system with audit occurring preferably continuously but at least annually and after any security event(s).' },
    'CEK-12': { name: 'Key Rotation', description: 'Rotate cryptographic keys in accordance with the calculated cryptoperiod, which includes provisions for considering the risk of information disclosure and legal and regulatory requirements.' },
    'CEK-13': { name: 'Key Revocation', description: 'Define, implement and evaluate processes, procedures and technical measures to revoke and remove cryptographic keys prior to the end of its established cryptoperiod, when a key is compromised, or an entity is no longer part of the organization, which include provisions for legal and regulatory requirements.' },
    'CEK-14': { name: 'Key Destruction', description: 'Define, implement, and evaluate processes, procedures, and technical measures to securely destroy cryptographic keys when they are no longer needed, which include provisions for legal and regulatory requirements.' },
    'CEK-17': { name: 'Key Deactivation', description: 'Define, implement and evaluate processes, procedures and technical measures to deactivate keys at the time of their expiration date, which include provisions for legal and regulatory requirements.' },
    'CEK-18': { name: 'Key Archival', description: 'Define, implement and evaluate processes, procedures and technical measures to manage archived keys in a secure repository requiring least privilege access, which include provisions for legal and regulatory requirements.' },
    'CEK-21': { name: 'Key Inventory Management', description: 'Define, implement and evaluate processes, procedures and technical measures in order for the key management system to track and report all cryptographic materials and changes in status, which include provisions for legal and regulatory requirements.' },
  },
  // DCS
  'DCS': {
    'DCS-01': { name: 'Off-Site Equipment Disposal Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for the secure disposal of equipment used outside the organization\'s premises. If the equipment is not physically destroyed a data destruction procedure that renders recovery of information impossible must be applied. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'DCS-02': { name: 'Off-Site Transfer Authorization Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for the relocation or transfer of hardware, software, or data/information to an offsite or alternate location. The relocation or transfer request requires the written or cryptographically verifiable authorization. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'DCS-03': { name: 'Secure Area Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for maintaining a safe and secure working environment in offices, rooms, and facilities. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'DCS-04': { name: 'Secure Media Transportation Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for the secure transportation of physical media. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'DCS-05': { name: 'Assets Classification', description: 'Classify and document the physical, and logical assets (e.g., applications) based on the organizational business risk. Review and update the assets’ classification at least annually or upon significant changes.' },
    'DCS-06': { name: 'Assets Cataloguing and Tracking', description: 'Catalogue and track all relevant physical and logical assets located at all of the service providers sites within a secured system. Review and update the catalogue at least annually or upon significant changes.' },
    'DCS-07': { name: 'Controlled Physical Access Points', description: 'Design and implement physical security perimeters to safeguard personnel, data, and information systems.' },
    'DCS-08': { name: 'Equipment Identification', description: 'Use equipment identification as a method for connection authentication.' },
    'DCS-09': { name: 'Secure Area Authorization', description: 'Allow only authorized personnel access to secure areas, with all ingress and egress points restricted, documented, and monitored by physical access control mechanisms. Retain access control records on a periodic basis as deemed appropriate by the organization.' },
    'DCS-10': { name: 'Surveillance System', description: 'Implement, maintain, and operate datacenter surveillance systems at the external perimeter and at all the ingress and egress points to detect unauthorized ingress and egress attempts.' },
    'DCS-11': { name: 'Adverse Event Response Training', description: 'Train datacenter personnel to safely manage adverse events, including but not limited to unauthorized ingress and egress attempts.' },
    'DCS-14': { name: 'Secure Utilities', description: 'Secure, monitor, maintain, and test utilities services for continual effectiveness at planned intervals.' },
    'DCS-15': { name: 'Equipment Location', description: 'Keep business-critical equipment away from locations subject to high probability for environmental risk events.' },
  },
  // DSP
  'DSP': {
    'DSP-01': { name: 'Security and Privacy Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for the classification, protection, preparation and handling of data throughout its lifecycle, and according to all applicable laws and regulations,standards, and risk level. Review and update the policies and procedures at least annually.' },
    'DSP-02': { name: 'Secure Disposal', description: 'Apply industry accepted methods for the secure disposal of data from storage media such that data is not recoverable by any forensic means.' },
    'DSP-03': { name: 'Data Inventory', description: 'Create and maintain a data inventory, at least for any sensitive, regulated and personal data. Review and update the inventory at least annually or upon significant changes.' },
    'DSP-04': { name: 'Data Classification', description: 'Classify data according to its type and sensitivity level.' },
    'DSP-05': { name: 'Data Flow Documentation', description: 'Create data flow documentation to identify what data is processed, stored or transmitted where. Review data flow documentation at defined intervals, at least annually, and after any change.' },
    'DSP-06': { name: 'Data Ownership and Stewardship', description: 'Document ownership and stewardship of all relevant documented personal and sensitive data. Perform review at least annually.' },
    'DSP-07': { name: 'Data Protection by Design and Default', description: 'Develop systems, products, and business practices based upon a principle of security by design and industry best practices.' },
    'DSP-08': { name: 'Data Privacy by Design and Default', description: 'Develop systems, products, and business practices based upon a principle of privacy by design and industry best practices. Ensure that systems\' privacy settings are configured by default, according to all applicable laws and regulations.' },
    'DSP-09': { name: 'Data Protection Impact Assessment', description: 'Conduct a Data Protection Impact Assessment (DPIA) to evaluate the origin, nature, particularity and severity of the risks upon the processing of personal data, according to any applicable laws, regulations and industry best practices.' },
    'DSP-10': { name: 'Sensitive Data Transfer', description: 'Define, implement and evaluate processes, procedures and technical measures that ensure any transfer of personal or sensitive data is protected from unauthorized access and only processed within scope as permitted by the respective laws and regulations.' },
    'DSP-13': { name: 'Personal Data Sub-processing', description: 'Define, implement and evaluate processes, procedures and technical measures for the transfer and sub-processing of personal data within the service supply chain, according to any applicable laws and regulations.' },
    'DSP-14': { name: 'Disclosure of Data Sub-processors', description: 'Define, implement and evaluate processes, procedures and technical measures to disclose the details of any personal or sensitive data access by sub-processors to the data owner prior to initiation of that processing.' },
    'DSP-17': { name: 'Sensitive Data Protection', description: 'Define and implement, processes, procedures and technical measures to protect sensitive data throughout its lifecycle.' },
    'DSP-18': { name: 'Disclosure Notification', description: 'The providers should implement and describe to customers the procedure to manage and respond to requests for disclosure of Personal Data by Law Enforcement Authorities according to applicable laws and regulations.' },
    'DSP-20': { name: 'Data Provenance and Transparency', description: 'Define, implement and evaluate processes, procedures and technical measures to: 1) Document and trace data sources, and 2) Make the data source available according to legal and regulatory requirements' },
    'DSP-21': { name: 'Data Poisoning Prevention & Detection', description: 'Define, implement and evaluate processes, procedures and technical measures to prevent data poisoning in AI models and continuously detect such.' },
    'DSP-22': { name: 'Privacy Enhancing Technologies', description: 'Use Privacy Enhancing Technologies for training data, informed by risk and privacy impact analysis and business use cases.' },
    'DSP-23': { name: 'Data Integrity Check', description: 'Regularly validate the consistency and conformity of training, fine-tuning or augmentation data. Implement dataset versioning to ensure traceability and enforce restrictions to prevent unauthorized changes.' },
    'DSP-24': { name: 'Data Differentiation and Relevance', description: 'Ensure training-data differentiation and relevance to the intended use of the AI Model.' },
  },
  // GRC
  'GRC': {
    'GRC-01': { name: 'Governance Program Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for an information governance program, which is sponsored by the leadership of the organization and related to AI systems as well. Review and update the policies and procedures at least annually.' },
    'GRC-02': { name: 'Risk Management Program', description: 'Establish and maintain a formal, documented, and leadership-sponsored AI Risk Management (AIRM) program that includes policies and procedures for identification, evaluation, ownership, treatment, and acceptance of risks.' },
    'GRC-03': { name: 'Organizational Policy Reviews', description: 'Review all relevant organizational policies and associated procedures at least annually or when a substantial change occurs within the organization.' },
    'GRC-06': { name: 'Governance Responsibility Model', description: 'Define and document roles and responsibilities for planning, implementing, operating, assessing, and improving governance programs.' },
    'GRC-07': { name: 'Information System Regulatory Mapping', description: 'Identify and document all relevant standards, regulations, legal/contractual, and statutory requirements, which are applicable to your organization. Review at least annually or when a substantial change occurs within the organization.' },
    'GRC-08': { name: 'Special Interest Groups', description: 'Establish and maintain contact with related special interest groups and other relevant entities in line with business context.' },
    'GRC-14': { name: 'Explainability Evaluation', description: 'Evaluate, document, and communicate the degree of explainability of the AI Services, including possible limitations and exceptions.' },
    'GRC-15': { name: 'Human supervision', description: 'Establish, execute, and assess processes, procedures, and technical measures to ensure human oversight and control of the AI system in compliance with regulatory requirements and organizational risk management.' },
  },
  // HRS
  'HRS': {
    'HRS-01': { name: 'Background Screening Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for background verification of all new employees (including but not limited to remote employees, contractors, and third parties) according to local laws, regulations, ethics, and contractual constraints and proportional to the data classification to be accessed, the business requirements, and acceptable risk. Review and update the policies and procedures at least annually.' },
    'HRS-03': { name: 'Clean Desk Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures that require unattended workspaces to not have openly visible confidential data. Review and update the policies and procedures at least annually.' },
    'HRS-05': { name: 'Asset returns', description: 'Establish and document procedures for the return of organization-owned assets by terminated employees.' },
    'HRS-07': { name: 'Employment Agreement Process', description: 'Employees sign the employee agreement prior to being granted access to organizational information systems, resources and assets.' },
    'HRS-09': { name: 'Personnel Roles and Responsibilities', description: 'Document and communicate roles and responsibilities of employees, as they relate to information assets and security.' },
    'HRS-10': { name: 'Non-Disclosure Agreements', description: 'Identify, document, and review, at planned intervals, requirements for non-disclosure/confidentiality agreements reflecting the organization\'s needs for the protection of data and operational details.' },
    'HRS-11': { name: 'Security Awareness Training', description: 'Establish, document, approve, communicate, apply, evaluate and maintain a security awareness training program for all employees of the organization and provide regular training updates.' },
    'HRS-12': { name: 'Personal and Sensitive Data Awareness and Training', description: 'Provide employees with access to sensitive organizational and personal data with appropriate security awareness training and regular updates in organizational procedures, processes, and policies relating to their professional function relative to the organization.' },
    'HRS-13': { name: 'Compliance User Responsibility', description: 'Make employees aware of their roles and responsibilities for maintaining awareness and compliance with established policies and procedures and applicable legal, statutory, or regulatory compliance obligations.' },
    'HRS-14': { name: 'AI Competency Training', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures defining the AI training program for all relevant personnel of the organization based on their roles and provide regular training updates.' },
  },
  // I&S
  'I&S': {
    'I&S-01': { name: 'Infrastructure and Virtualization Security Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for infrastructure and virtualization security. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'I&S-02': { name: 'Capacity and Resource Planning', description: 'Plan and monitor the availability, quality, and adequate capacity of resources in order to deliver the required system performance as determined by the business.' },
    'I&S-03': { name: 'Network Security', description: 'Monitor, encrypt and restrict communications between environments to only authenticated and authorized connections, as justified by the business. Review these configurations at least annually, and support them by a documented justification of all allowed services, protocols, ports, and compensating controls.' },
    'I&S-04': { name: 'OS Hardening and Base Controls', description: 'Harden host and guest OS, hypervisor or infrastructure control plane, according to their respective best practices, and supported by technical controls, as part of a security baseline.' },
    'I&S-05': { name: 'Production and Non-Production Environments', description: 'Separate production and non-production environments.' },
    'I&S-06': { name: 'Segmentation and Segregation', description: 'Design, develop, deploy and configure applications and infrastructures such that tenant access is appropriately segmented and segregated, monitored and restricted.' },
    'I&S-07': { name: 'Migration to Hosted Environments', description: 'Use secure and encrypted communication channels when migrating servers, services, applications, or data to hosted environments. Such channels must include only up-to-date and approved protocols.' },
    'I&S-08': { name: 'Network Architecture Documentation', description: 'Identify and document high-risk environments.' },
    'I&S-09': { name: 'Network Defense', description: 'Define, implement and evaluate processes, procedures and defense-in-depth techniques for protection, detection, and timely response to network-based attacks.' },
  },
  // IAM
  'IAM': {
    'IAM-01': { name: 'Identity and Access Management Policy and Procedures', description: 'Establish, document, approve, communicate, implement, apply, evaluate and maintain policies and procedures for identity and access management. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'IAM-02': { name: 'Strong Password Policy and Procedures', description: 'Establish, document, approve, communicate, implement, apply, evaluate and maintain strong password policies and procedures. Review and update the policies and procedures at least annually.' },
    'IAM-04': { name: 'Separation of Duties', description: 'Employ the separation of duties principle when implementing information system access.' },
    'IAM-05': { name: 'Least Privilege', description: 'Employ the least privilege principle when implementing information system access.' },
    'IAM-08': { name: 'User Access Review', description: 'Review and revalidate user access for least privilege and separation of duties with a frequency that is commensurated with organizational risk tolerance and at least annually, or upon significant changes.' },
    'IAM-09': { name: 'Segregation of Privileged Access Roles', description: 'Define, implement and evaluate processes, procedures and technical measures for the segregation of privileged access roles.' },
    'IAM-10': { name: 'Management of Privileged Access Roles', description: 'Define and implement an access process to ensure privileged access roles and rights are granted for a time limited period, and implement procedures to prevent the accumulation of segregated privileged access.' },
    'IAM-11': { name: 'Customers\' Approval for Agreed Privileged Access Roles', description: 'Define, implement and evaluate processes and procedures for customers to participate, where applicable, in the granting of access for agreed, high risk (as defined by the organizational risk assessment) privileged access roles.' },
    'IAM-16': { name: 'Authorization Mechanisms', description: 'Define, implement and evaluate processes, procedures and technical measures to verify access to data and system functions is authorized.' },
    'IAM-18': { name: 'Output Modification and Special Authorization', description: 'When allowing model output modification of AI generated output, establish a role for this access and allow changes only by authorized identities.' },
  },
  // IPY
  'IPY': {
    'IPY-01': { name: 'Interoperability and Portability Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for interoperability and portability including requirements for: a. Communications between application interfaces b. Information processing interoperability c. Application development portability d. Information/Data exchange, usage, portability, integrity, and persistence Review and update the policies and procedures at least annually or upon significant changes.' },
    'IPY-02': { name: 'Application Interface Availability', description: 'Provide application interface(s) to AICs so that they programmatically retrieve their data to enable interoperability and portability.' },
  },
  // LOG
  'LOG': {
    'LOG-02': { name: 'Audit Logs Protection', description: 'Define, implement and evaluate processes, procedures and technical measures to ensure the security and retention of audit logs.' },
    'LOG-03': { name: 'Security Monitoring and Alerting', description: 'Identify and monitor security-related events within applications, the underlying infrastructure, supply chain, and consider logging other events based on risk evaluation. Define and implement a system to generate alerts to responsible stakeholders based on such events and corresponding metrics.' },
    'LOG-04': { name: 'Audit Logs Access and Accountability', description: 'Restrict access to audit logs and maintain records of access to logs.' },
    'LOG-06': { name: 'Clock Synchronization', description: 'Use a reliable time source across all relevant information processing systems.' },
    'LOG-08': { name: 'Log Records', description: 'Generate audit records containing relevant security information.' },
    'LOG-10': { name: 'Encryption Monitoring and Reporting', description: 'Establish and maintain a monitoring and internal reporting capability over the operations of cryptographic, encryption and key management policies, processes, procedures, and controls.' },
    'LOG-11': { name: 'Transaction/Activity Logging', description: 'Log and monitor key lifecycle management events to enable auditing and reporting on usage of cryptographic keys.' },
    'LOG-13': { name: 'Failures and Anomalies Reporting', description: 'Define, implement and evaluate processes, procedures and technical measures for the reporting of anomalies and failures of the monitoring system and provide immediate notification to the accountable party.' },
    'LOG-14': { name: 'Input Monitoring', description: 'Log and monitor all input events (content and metadata) to enable auditing and reporting on the usage of AI models.' },
    'LOG-15': { name: 'Output Monitoring', description: 'Log and monitor all output events (content and metadata) to enable auditing and reporting on usage of AI models.' },
  },
  // MDS
  'MDS': {
    'MDS-03': { name: 'Model Documentation', description: 'Define, implement, enforce, approve, document, communicate, maintain and evaluate processes and procedures for model documentation. Regularly review and update the model documentation.' },
    'MDS-04': { name: 'Model Documentation Requirements', description: 'Establish and implement baseline requirements for Model documentation.' },
    'MDS-05': { name: 'Model Documentation Validation', description: 'Define, implement, and evaluate processes, procedures, and technical measures for the validation of the Model documentation aligned with the current model.' },
    'MDS-07': { name: 'Robustness against Adversarial Attack / Model Hardening', description: 'Define, implement, and evaluate processes, procedures, and technical measures for Model Hardening to mitigate relevant adversarial attacks as identified in the Threat Analysis and Adversarial Threat Analysis.' },
    'MDS-08': { name: 'Model Integrity Checks', description: 'Regularly calculate and compare checksums using cryptographic hashes of model checkpoints to detect unauthorized modifications. Apply at least annually based on the level of risk, or after any change of hands.' },
    'MDS-09': { name: 'Model Signing/Ownership Verification', description: 'Sign models cryptographically and verify signatures to ensure model provenance and ownership, any time the model changes hands or is loaded from storage.' },
    'MDS-10': { name: 'Model Continuous Monitoring', description: 'Define, implement, and evaluate processes, procedures, and technical measures for continuous monitoring of model performance metrics over time to identify sudden shifts or unexpected changes in predictions that could degrade model performance.' },
    'MDS-12': { name: 'Open Model Risk Assessment', description: 'Establish a process to evaluate risk associated with open models. Periodically review these risk factors, and implement a process to monitor and mitigate any determined vulnerabilities.' },
    'MDS-13': { name: 'Secure Model Format', description: 'Adopt secure model formats and processes for AI model serialization where applicable.' },
  },
  // SEF
  'SEF': {
    'SEF-01': { name: 'Security Incident Management Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for Security Incident Management, E-Discovery, and Forensics. Review and update the policies and procedures at least annually or upon significant changes.' },
    'SEF-03': { name: 'Incident Response Plans', description: 'Establish, document, approve, communicate, apply, evaluate and maintain a security incident response plan, which includes but is not limited to: a communication strategy for notifying relevant internal departments, impacted AICs, and other business critical relationships (such as supply-chain) that may be impacted.' },
    'SEF-04': { name: 'Incident Response Testing', description: 'Follow a structured approach to evaluate the effectiveness of incident response plans at planned intervals or upon significant changes.' },
    'SEF-05': { name: 'Incident Response Metrics', description: 'Establish, monitor and report information security incident metrics.' },
    'SEF-06': { name: 'Event Triage Processes', description: 'Define, implement and evaluate processes, procedures and technical measures supporting business processes to triage security-related events.' },
    'SEF-07': { name: 'Security Breach Notification', description: 'Define and implement, processes, procedures and technical measures for security breach notifications. Report material security breaches and assumed security breaches including any relevant supply chain breaches, as per applicable SLAs, laws and regulations.' },
    'SEF-08': { name: 'Points of Contact Maintenance', description: 'Maintain points of contact for applicable regulation authorities, national and local law enforcement, and other legal jurisdictional authorities. Review and update the points of contact at least annually.' },
    'SEF-09': { name: 'Incident Response', description: 'Define incident categories and severity levels for AI systems, and determine response procedures for each, including automated response where applicable.' },
  },
  // STA
  'STA': {
    'STA-01': { name: 'Supply Chain Risk Management Policies and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate, and maintain policies and procedures for supply chain risk management. Review and update the policies and procedures at least annually or upon significant changes.' },
    'STA-02': { name: 'SSRM Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for the application of the Shared Security Responsibility Model (SSRM) within the organization. Review and update the policies and procedures at least annually, or upon significant changes.' },
    'STA-03': { name: 'SSRM Supply Chain', description: 'Apply, document, implement and manage the SSRM throughout the supply chain.' },
    'STA-04': { name: 'SSRM Guidance', description: 'Provide SSRM Guidance to the Customer detailing information about the SSRM applicability throughout the supply chain.' },
    'STA-05': { name: 'SSRM Control Ownership', description: 'Delineate the shared ownership and applicability of all CSA AICM controls according to the SSRM.' },
    'STA-06': { name: 'SSRM Documentation Review', description: 'Review and validate SSRM documentation.' },
    'STA-07': { name: 'SSRM Control Implementation', description: 'Implement, operate, and audit or assess the portions of the SSRM which the organization is responsible for.' },
    'STA-08': { name: 'Supply Chain Inventory', description: 'Develop and maintain an inventory of all supply chain relationships.' },
    'STA-09': { name: 'Supply Chain Risk Management', description: 'Periodically review risk factors associated with supply chain relationships.' },
    'STA-10': { name: 'Primary Service and Contractual Agreement', description: 'Service agreements must incorporate at least the following mutually-agreed upon provisions and/or terms: • Scope, characteristics and location of business relationship and services offered • Information security requirements (including SSRM) • Change management process • Logging and monitoring capability • Incident management and communication procedures • Right to audit and third party assessment • Service termination • Interoperability and portability requirements • Data privacy' },
    'STA-11': { name: 'Supply Chain Agreement Review', description: 'Review supply chain agreements at least annually, or upon significant changes.' },
    'STA-13': { name: 'Supply Chain Service Agreement Compliance', description: 'Implement policies requiring all service providers throughout the supply chain to comply with information security, confidentiality, access control, privacy, audit, personnel policy and service level requirements and standards.' },
    'STA-14': { name: 'Supply Chain Governance Review', description: 'Periodically review the organization\'s supply chain partners\' IT governance policies and procedures.' },
    'STA-15': { name: 'Supply Chain Data Security Assessment', description: 'Define and implement a process for conducting security assessments periodically for all organizations within the supply chain.' },
  },
  // TVM
  'TVM': {
    'TVM-01': { name: 'Threat and Vulnerability Management Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures to identify, report and prioritize the remediation of vulnerabilities and threats, in order to protect systems against vulnerability exploitation. Review and update the policies and procedures at least annually or upon significant changes.' },
    'TVM-02': { name: 'Malware and Malicious Instructions Protection Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures to protect against malware and malicious instructions. Review and update the policies and procedures at least annually or upon significant changes.' },
    'TVM-03': { name: 'Vulnerability Identification', description: 'Define, implement and evaluate processes, procedures and technical measures to enable both scheduled and emergency responses to vulnerability identifications, based on the identified risk.' },
    'TVM-04': { name: 'Detection Updates', description: 'Define, implement and evaluate processes, procedures and technical measures to update detection tools, threat signatures, and indicators of compromise on a weekly, or more frequent basis.' },
    'TVM-05': { name: 'External Library Vulnerabilities', description: 'Define, implement and evaluate processes, procedures and technical measures to identify updates for applications which use third party or open source libraries according to the organization\'s vulnerability management policy.' },
    'TVM-06': { name: 'Penetration Testing', description: 'Define, implement and evaluate processes, procedures and technical measures for the periodic performance of penetration testing by independent third parties.' },
    'TVM-07': { name: 'Vulnerability Remediation Schedule', description: 'Define, implement and evaluate processes, procedures and technical measures based on identified risks to support scheduled and emergency responses to vulnerability identification.' },
    'TVM-08': { name: 'Vulnerability Prioritization', description: 'Use a risk-based model for effective prioritization of vulnerability remediation using an industry recognized framework.' },
    'TVM-09': { name: 'Vulnerability Management Reporting', description: 'Define and implement a process for tracking and reporting vulnerability identification and remediation activities that includes stakeholder notification.' },
    'TVM-10': { name: 'Vulnerability Management Metrics', description: 'Establish, monitor and report metrics for vulnerability identification and remediation at defined intervals.' },
    'TVM-11': { name: 'Guardrails', description: 'Define and implement processes, procedures and technical measures to apply guardrails to the AI system. Continuously evaluate guardrails for changes in regulatory requirements and risk scenarios.' },
    'TVM-12': { name: 'Threat Analysis and Modelling', description: 'Define implement and evaluate threat analysis process and procedures to identify, assess and review the threat landscape for Cloud and AI systems. Build threat models according to industry best practices to inform the risk mitigation strategy.' },
    'TVM-13': { name: 'Threat Response', description: 'Use a risk-based method for the prioritization and mitigation of threats, leveraging an industry-recognized framework to guide threat decision-making and protection measures.' },
  },
  // UEM
  'UEM': {
    'UEM-01': { name: 'Endpoint Devices Policy and Procedures', description: 'Establish, document, approve, communicate, apply, evaluate and maintain policies and procedures for all endpoints. Review and update the policies and procedures at least annually or upon significant system changes.' },
    'UEM-02': { name: 'Application and Service Approval', description: 'Define, document, apply and evaluate a list of approved services, applications and sources of applications (stores) acceptable for use by endpoints when accessing or storing organization-managed data.' },
    'UEM-03': { name: 'Compatibility', description: 'Define and implement a process for the validation of the endpoint device\'s compatibility with operating systems and applications.' },
    'UEM-04': { name: 'Endpoint Inventory', description: 'Maintain an inventory of all endpoints used to store and process company data.' },
    'UEM-05': { name: 'Endpoint Management', description: 'Define, implement and evaluate processes, procedures and technical measures to enforce policies and controls for all endpoints permitted to access systems and/or store, transmit, or process organizational data.' },
    'UEM-06': { name: 'Automatic Lock Screen', description: 'Configure all relevant interactive-use endpoints to require an automatic lock screen.' },
    'UEM-07': { name: 'Operating Systems', description: 'Manage changes to endpoint operating systems, patch levels, and/or applications through the company\'s change management processes.' },
    'UEM-08': { name: 'Storage Encryption', description: 'Protect information from unauthorized disclosure on managed endpoint devices with storage encryption.' },
    'UEM-09': { name: 'Anti-Malware Detection and Prevention', description: 'Configure managed endpoints with anti-malware detection and prevention technology and services.' },
    'UEM-11': { name: 'Data Loss Prevention', description: 'Configure managed endpoints with Data Loss Prevention (DLP) technologies and rules in accordance with a risk assessment.' },
    'UEM-14': { name: 'Third-Party Endpoint Security Posture', description: 'Define, implement and evaluate processes, procedures and technical and/or contractual measures to maintain proper security of third-party endpoints with access to organizational assets.' },
  },
};

const AICM_V1_CONTROL_IDS = Object.entries(AICM_V1_DOMAINS).flatMap(
  ([dom, ctrls]) => Object.keys(ctrls).map(id => id)
);

module.exports = { AICM_V1_DOMAINS, AICM_V1_CONTROL_IDS };
