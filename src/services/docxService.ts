import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  TabStopType,
  TabStopPosition,
} from "docx";
import { ResumeData, ResumeFormat } from "@/types";

// CONSTANTS
const FONT_FAMILY = "Calibri";
const COLOR_BLACK = "000000"; // STRICTLY BLACK

// Sizes (Half-points): 22 = 11pt, 28 = 14pt
const SIZE_NAME = 28;       // 14pt
const SIZE_TEXT = 22;       // 11pt

// Margins: Narrow (0.5 inch)
const NARROW_MARGIN = convertInchesToTwip(0.5);
const MARGINS = {
  top: NARROW_MARGIN,
  bottom: NARROW_MARGIN,
  left: NARROW_MARGIN,
  right: NARROW_MARGIN,
};

// Calculate writable width for tabs (8.5in - 0.5in - 0.5in = 7.5in)
const WRITABLE_WIDTH_TWIPS = convertInchesToTwip(7.5);

// Spacing: Single line (240 twips), 0 before/after
const SINGLE_LINE = {
    line: 240,
    before: 0,
    after: 0,
};

export const generateResumeDoc = async (data: ResumeData, format: ResumeFormat = ResumeFormat.CLASSIC_PROFESSIONAL): Promise<Blob> => {
  const isModern = format === ResumeFormat.MODERN_EXECUTIVE;
  
  // Dynamic Styles
  const FONT_FAMILY = isModern ? "Arial" : "Calibri";
  const SIZE_NAME = isModern ? 24 : 28; // 12pt vs 14pt (half-points)
  const SIZE_TEXT = 22; // 11pt

  const formatModernDate = (dateStr: string) => {
      if (!dateStr) return "";
      const monthMap: { [key: string]: string } = {
          "Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April",
          "May": "May", "Jun": "June", "Jul": "July", "Aug": "August",
          "Sep": "September", "Oct": "October", "Nov": "November", "Dec": "December",
          "Sept": "September"
      };
      let formatted = dateStr;
      Object.keys(monthMap).forEach(short => {
          const regex = new RegExp(`\\b${short}\\b`, 'g');
          formatted = formatted.replace(regex, monthMap[short]);
      });
      return formatted;
  };

  // Helper to split long sentences into bullets if they contain periods
  const processDescription = (items: string[]) => {
      if (!items) return [];
      const processed: string[] = [];
      items.forEach(item => {
          if (item.length > 100 && item.includes('.')) {
             // Split by period, but ignore periods in common abbreviations (e.g., "Mr.", "Inc.") if possible.
             // For simplicity, we split by ". " or "." at end of string.
             const sentences = item.split(/\. (?=[A-Z])|\.$/g).filter(s => s.trim().length > 0);
             sentences.forEach(s => {
                 const trimmed = s.trim();
                 processed.push(trimmed.endsWith('.') ? trimmed : `${trimmed}.`);
             });
          } else {
              processed.push(item);
          }
      });
      return processed;
  };

  const emptyLine = () => new Paragraph({
      text: "",
      children: [new TextRun({ text: "", font: FONT_FAMILY, size: SIZE_TEXT })],
      spacing: { after: 0, before: 0, line: 240 },
  });

  // Helper for manual bullets to ensure exact size control
  // Hanging indent: First line starts at 0 relative to indent, wrapped lines start at 0.25in.
  // We place a bullet, a tab, then text.
  const createBulletParagraph = (text: string) => {
      return new Paragraph({
          indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) },
          spacing: SINGLE_LINE,
          tabStops: [
              { type: TabStopType.LEFT, position: convertInchesToTwip(0.25) }
          ],
          children: [
              new TextRun({ 
                  text: "•\t", // Small standard bullet
                  font: FONT_FAMILY, 
                  size: SIZE_TEXT, 
                  color: COLOR_BLACK 
              }),
              new TextRun({ 
                  text: text, 
                  font: FONT_FAMILY, 
                  size: SIZE_TEXT, 
                  color: COLOR_BLACK 
              })
          ]
      });
  };

  // Dynamic Header Creator
  const createSectionHeader = (text: string) => {
    const title = text.trim().endsWith(':') ? text.trim() : `${text.trim()}:`;
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { ...SINGLE_LINE, after: isModern ? 120 : 0 }, // Add spacing for Modern (120 twips = 6pt)
      border: undefined,
      children: [
        new TextRun({
          text: title,
          font: FONT_FAMILY,
          size: SIZE_TEXT,
          bold: true,
          allCaps: true,
          color: COLOR_BLACK,
        }),
      ],
    });
  };

  // Job Header: Company, Location (Bold) ... Dates (Bold)
  // Uses TabStop for right alignment instead of Table to prevent premature wrapping
  const createJobHeader = (company: string, location: string, dates?: string) => {
    const leftText = location ? `${company}, ${location}` : company;
    
    const children = [
      new TextRun({
        text: leftText,
        font: FONT_FAMILY,
        size: SIZE_TEXT,
        bold: true,
        color: COLOR_BLACK,
      })
    ];

    if (dates && dates !== "undefined") {
      children.push(
        new TextRun({
          text: `\t${dates}`, // Tab to right, then date
          font: FONT_FAMILY,
          size: SIZE_TEXT,
          bold: true,
          color: COLOR_BLACK,
        })
      );
    }

    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: SINGLE_LINE,
      tabStops: [
        {
          type: TabStopType.RIGHT,
          position: WRITABLE_WIDTH_TWIPS,
        },
      ],
      children: children,
    });
  };

  // Grid for Skills/Languages
  const createGrid = (items: string[]) => {
    const rows: TableRow[] = [];
    for (let i = 0; i < items.length; i += 2) {
      const item1 = items[i];
      const item2 = items[i + 1];

      const cellContent = (text: string) => 
        new Paragraph({
          indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) },
          spacing: SINGLE_LINE,
          tabStops: [
              { type: TabStopType.LEFT, position: convertInchesToTwip(0.25) }
          ],
          children: [
            new TextRun({ text: "•\t", font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK }),
            new TextRun({ text: text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK }),
          ]
        });

      const cells = [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          children: [cellContent(item1)],
          borders: {
            top: { style: BorderStyle.NIL },
            bottom: { style: BorderStyle.NIL },
            left: { style: BorderStyle.NIL },
            right: { style: BorderStyle.NIL },
          },
        }),
      ];

      if (item2) {
        cells.push(
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [cellContent(item2)],
            borders: {
              top: { style: BorderStyle.NIL },
              bottom: { style: BorderStyle.NIL },
              left: { style: BorderStyle.NIL },
              right: { style: BorderStyle.NIL },
            },
          })
        );
      } else {
         cells.push(new TableCell({ 
           children: [], 
           width: { size: 50, type: WidthType.PERCENTAGE },
           borders: {
            top: { style: BorderStyle.NIL },
            bottom: { style: BorderStyle.NIL },
            left: { style: BorderStyle.NIL },
            right: { style: BorderStyle.NIL },
          },
         }));
      }
      rows.push(new TableRow({ children: cells }));
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NIL },
        bottom: { style: BorderStyle.NIL },
        left: { style: BorderStyle.NIL },
        right: { style: BorderStyle.NIL },
        insideVertical: { style: BorderStyle.NIL },
        insideHorizontal: { style: BorderStyle.NIL },
      },
      rows: rows,
    });
  };

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK },
          paragraph: { spacing: SINGLE_LINE }
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: MARGINS },
        },
        children: [
          // 1. NAME
          new Paragraph({
            alignment: isModern ? AlignmentType.LEFT : AlignmentType.CENTER,
            spacing: SINGLE_LINE,
            children: [
              new TextRun({
                text: data.fullName,
                font: FONT_FAMILY,
                size: SIZE_NAME,
                bold: true,
                color: COLOR_BLACK,
              }),
            ],
          }),
          // Contact Info
          ...(isModern && data.contactInfo?.location ? [
            new Paragraph({
                alignment: isModern ? AlignmentType.LEFT : AlignmentType.CENTER,
                spacing: { after: 200 }, // Add some space after header
                children: [
                    new TextRun({
                        text: data.contactInfo?.location || "", // Always only location for privacy
                        font: FONT_FAMILY,
                        size: isModern ? SIZE_NAME : SIZE_TEXT, // Modern: 12pt (same as name), Classic: 11pt
                        bold: isModern, // Modern: Bold
                        color: COLOR_BLACK,
                    })
                ]
            })
          ] : []),
          emptyLine(),

          // 2. SUMMARY
          ...(data.summary ? [
            createSectionHeader(data.sectionTitleSummary || "SUMMARY"),
            ...(Array.isArray(data.summary) ? data.summary : [data.summary]).map(item => {
               if (Array.isArray(data.summary) && data.summary.length > 1) {
                  return createBulletParagraph(item);
               }
               return new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      font: FONT_FAMILY,
                      size: SIZE_TEXT,
                      color: COLOR_BLACK,
                    }),
                  ],
                  spacing: SINGLE_LINE,
               });
            }),
            emptyLine(),
          ] : []),

          // 3. EXPERIENCE
          ...(data.experience && data.experience.length > 0 ? [
            createSectionHeader(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE"),
            ...data.experience.flatMap((exp) => {
              const elements = [];
              
              if (isModern) {
                  // Modern Layout: Date -> Company -> Title
                  // Date
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: formatModernDate(exp.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  // Company, Location
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  // Title
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: exp.title, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: exp.title,
                         font: FONT_FAMILY,
                         size: SIZE_TEXT,
                         bold: true,
                         color: COLOR_BLACK,
                       }),
                     ],
                  }));
              }

              if (exp.description) {
                processDescription(exp.description).forEach(bullet => {
                  elements.push(createBulletParagraph(bullet));
                });
              }
              elements.push(emptyLine());
              return elements;
            }),
          ] : []),

          // 4. INTERNSHIPS (Handle exactly like experience)
          ...(data.internships && data.internships.length > 0 ? [
            createSectionHeader(data.sectionTitleInternships || "INTERNSHIPS"),
            ...data.internships.flatMap((exp) => {
              const elements = [];
              
              if (isModern) {
                  // Modern Layout
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: formatModernDate(exp.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: exp.title, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: exp.title,
                         font: FONT_FAMILY,
                         size: SIZE_TEXT,
                         bold: true,
                         color: COLOR_BLACK,
                       }),
                     ],
                  }));
              }

              if (exp.description) {
                processDescription(exp.description).forEach(bullet => {
                  elements.push(createBulletParagraph(bullet));
                });
              }
              elements.push(emptyLine());
              return elements;
            }),
          ] : []),

          // 5. EDUCATION
          ...(data.education && data.education.length > 0 ? [
            createSectionHeader(data.sectionTitleEducation || "EDUCATION"),
            ...data.education.flatMap((edu) => {
               const elements = [];
               
               if (isModern) {
                   // Modern Layout: Date -> Institution -> Degree
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: formatModernDate(edu.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: `${edu.institution}${edu.location ? `, ${edu.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: edu.degree, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
               } else {
                   // Classic Layout
                   elements.push(createJobHeader(edu.institution, edu.location || "", edu.dates));
                   elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [
                        new TextRun({
                          text: edu.degree,
                          font: FONT_FAMILY,
                          size: SIZE_TEXT,
                          bold: true,
                          color: COLOR_BLACK,
                        }),
                      ],
                   }));
               }

               if (edu.details && edu.details.length > 0) {
                 processDescription(edu.details).forEach(detail => {
                    elements.push(createBulletParagraph(detail));
                 });
               }
               elements.push(emptyLine());
               return elements;
            }),
          ] : []),

          // 6. CUSTOM SECTIONS (Skills, Tools, Languages, etc.)
          ...(data.customSections ? data.customSections.flatMap(section => {
             const titleUpper = section.title.toUpperCase();
             const isGridCandidate = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
             const hasLongItems = section.items && section.items.some(item => item.length > 60);

             const elements = [];
             elements.push(createSectionHeader(section.title));
             
             if (isGridCandidate && !hasLongItems && section.items) {
               elements.push(createGrid(section.items));
             } else if (section.items) {
               section.items.forEach(item => {
                 const isKeyValue = item.includes(":") && item.indexOf(":") < 20; 
                 if (isKeyValue) {
                    elements.push(new Paragraph({
                        spacing: SINGLE_LINE,
                        children: [
                          new TextRun({
                            text: item,
                            font: FONT_FAMILY,
                            size: SIZE_TEXT,
                            color: COLOR_BLACK,
                          }),
                        ],
                    }));
                 } else {
                    elements.push(createBulletParagraph(item));
                 }
               });
             }
             elements.push(emptyLine());
             return elements;
          }) : [])

        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
};