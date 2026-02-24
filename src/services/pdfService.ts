import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { ResumeData, ResumeFormat } from "@/types";

// Initialize fonts
// @ts-ignore
if (pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
  // @ts-ignore
  pdfMake.vfs = pdfFonts.pdfMake.vfs;
} else if (pdfFonts && (pdfFonts as any).vfs) {
  // @ts-ignore
  pdfMake.vfs = (pdfFonts as any).vfs;
} else {
  console.warn("Could not find vfs in pdfFonts", pdfFonts);
}

// Helper to format title with colon
const formatTitle = (title: string) => {
  const trimmed = title.trim();
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
};

// Helper to expand months for Modern format
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

export const generateResumePDF = (data: ResumeData, format: ResumeFormat | string = ResumeFormat.CLASSIC_PROFESSIONAL) => {
  console.log("generateResumePDF called with format:", format);
  
  const content: any[] = [];
  
  // Define styles based on format
  // Ensure we compare against the string value to avoid any enum object issues
  const isModern = format === 'MODERN_EXECUTIVE' || format === ResumeFormat.MODERN_EXECUTIVE;
  
  console.log("isModern calculated as:", isModern);
  
  const styles = {
      nameFontSize: isModern ? 12 : 18,
      bodyFontSize: isModern ? 11 : 11,
      nameAlignment: isModern ? 'left' : 'center',
      headerMargin: isModern ? [0, 0, 0, 15] : [0, 0, 0, 10],
      sectionHeaderDecoration: undefined,
      jobLayout: isModern ? 'modern' : 'classic'
  };

  // 1. Name
  content.push({
    text: data.fullName.toUpperCase(),
    style: 'nameHeader',
    alignment: styles.nameAlignment,
    margin: [0, 0, 0, 2]
  });

  // 2. Contact Info
  if (isModern && data.contactInfo?.location) {
      content.push({
          text: data.contactInfo.location,
          fontSize: isModern ? 12 : 11,
          bold: isModern,
          alignment: styles.nameAlignment,
          margin: isModern ? [0, 0, 0, 15] : [0, 0, 0, 10]
      });
  }

  // 3. Summary
  if (data.summary) {
    content.push({
      text: formatTitle(data.sectionTitleSummary || "SUMMARY").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 10, 0, 12] : [0, 10, 0, 5],
      decoration: isModern ? undefined : undefined // Classic preview has border-bottom, pdfmake is harder, keeping clean
    });

    if (Array.isArray(data.summary)) {
      if (data.summary.length === 1) {
        content.push({
          text: data.summary[0],
          style: 'bodyText',
          margin: [0, 0, 0, 5]
        });
      } else {
        content.push({
          ul: [...data.summary], 
          style: 'bodyText',
          margin: [0, 0, 0, 5]
        });
      }
    } else {
      content.push({
        text: data.summary,
        style: 'bodyText',
        margin: [0, 0, 0, 5]
      });
    }
  }

  // 4. Experience
  if (data.experience && data.experience.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 10, 0, 12] : [0, 10, 0, 5]
    });

    data.experience.forEach(exp => {
      if (isModern) {
          // Modern Layout: 
          // Date Range
          // Company, Location
          // Title (Italic)
          content.push({
              text: formatModernDate(exp.dates),
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: exp.title,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          // Classic Layout: Company | Date -> Title
          content.push({
            columns: [
              {
                text: [
                  { text: exp.company, bold: true },
                  exp.location ? `, ${exp.location}` : ''
                ],
                style: 'bodyText',
                width: '*'
              },
              {
                text: exp.dates,
                style: 'bodyText',
                bold: true,
                alignment: 'right',
                width: 'auto'
              }
            ],
            margin: [0, 0, 0, 2]
          });

          content.push({
            text: exp.title,
            style: 'bodyText',
            bold: true,
            margin: [0, 0, 0, 2]
          });
      }

      // Bullets
      if (exp.description && exp.description.length > 0) {
        content.push({
          ul: processDescription([...exp.description]), 
          style: 'bodyText',
          margin: [0, 0, 0, 8]
        });
      }
    });
  }

  // 5. Internships
  if (data.internships && data.internships.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleInternships || "INTERNSHIPS").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 10, 0, 12] : [0, 10, 0, 5]
    });

    data.internships.forEach(exp => {
      if (isModern) {
          content.push({
              text: formatModernDate(exp.dates),
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: exp.title,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          content.push({
            columns: [
              {
                text: [
                  { text: exp.company, bold: true },
                  exp.location ? `, ${exp.location}` : ''
                ],
                style: 'bodyText',
                width: '*'
              },
              {
                text: exp.dates,
                style: 'bodyText',
                bold: true,
                alignment: 'right',
                width: 'auto'
              }
            ],
            margin: [0, 0, 0, 2]
          });

          content.push({
            text: exp.title,
            style: 'bodyText',
            bold: true,
            margin: [0, 0, 0, 2]
          });
      }

      if (exp.description && exp.description.length > 0) {
        content.push({
          ul: processDescription([...exp.description]), 
          style: 'bodyText',
          margin: [0, 0, 0, 8]
        });
      }
    });
  }

  // 6. Education
  if (data.education && data.education.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleEducation || "EDUCATION").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 10, 0, 12] : [0, 10, 0, 5]
    });

    data.education.forEach(edu => {
      content.push({
        columns: [
          {
            text: [
              { text: edu.institution, bold: true },
              edu.location ? `, ${edu.location}` : ''
            ],
            style: 'bodyText',
            width: '*'
          },
          {
            text: isModern ? formatModernDate(edu.dates) : edu.dates,
            style: 'bodyText',
            bold: true,
            alignment: 'right',
            width: 'auto'
          }
        ],
        margin: [0, 0, 0, 2]
      });

      content.push({
        text: edu.degree,
        style: 'bodyText',
        bold: true,
        margin: [0, 0, 0, 2]
      });

      if (edu.details && edu.details.length > 0) {
        content.push({
          ul: processDescription([...edu.details]), 
          style: 'bodyText',
          margin: [0, 0, 0, 8]
        });
      }
    });
  }

  // 7. Custom Sections
  if (data.customSections) {
    data.customSections.forEach(section => {
      content.push({
        text: formatTitle(section.title).toUpperCase(),
        style: 'sectionHeader',
        margin: isModern ? [0, 10, 0, 12] : [0, 10, 0, 5]
      });

      const titleUpper = section.title.toUpperCase();
      const isGrid = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
      const hasLongItems = section.items && section.items.some(item => item.length > 60);

      if (isGrid && !hasLongItems && section.items) {
        // Create 2-column layout for skills
        const leftCol: any[] = [];
        const rightCol: any[] = [];
        
        section.items.forEach((item, idx) => {
          if (idx % 2 === 0) leftCol.push(item);
          else rightCol.push(item);
        });

        content.push({
          columns: [
            { ul: leftCol, style: 'bodyText' },
            { ul: rightCol, style: 'bodyText' }
          ],
          margin: [0, 0, 0, 5]
        });
      } else if (section.items) {
        const listItems = section.items.map(item => {
          const isKeyValue = item.includes(":");
          if (isKeyValue) {
            const parts = item.split(":");
            const key = parts[0];
            const value = parts.slice(1).join(":");
            return {
              text: [
                { text: key + ":", bold: true },
                value
              ],
              listType: 'none',
              margin: [0, 2, 0, 2]
            };
          }
          return item;
        });

        content.push({
          ul: listItems,
          style: 'bodyText',
          margin: [0, 0, 0, 5]
        });
      }
    });
  }

  const docDefinition = {
    content: content,
    styles: {
      nameHeader: {
        fontSize: styles.nameFontSize,
        bold: true
      },
      sectionHeader: {
        fontSize: styles.bodyFontSize,
        bold: true
      },
      bodyText: {
        fontSize: styles.bodyFontSize
      }
    },
    defaultStyle: {
      font: 'Roboto' // pdfmake default font
    }
  };

  pdfMake.createPdf(docDefinition).download(`Formatted_${data.fullName.replace(/\s+/g, '_')}_${isModern ? 'Modern' : 'Classic'}.pdf`);
};
