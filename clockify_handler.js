const axios = require('axios');

class ClockifyHandler {
    constructor(apiKey = null) {
        this.apiKey = apiKey;
        this.baseUrl = "https://api.clockify.me/api/v1";
        this.headers = apiKey ? { "X-Api-Key": apiKey } : {};
        this.workspaceId = null;
        this.userId = null;
    }

    async setup() {
        if (!this.apiKey) return false;

        try {
            // Get user info
            const userResponse = await axios.get(
                `${this.baseUrl}/user`,
                { headers: this.headers }
            );
            
            if (userResponse.status === 200) {
                this.userId = userResponse.data.id;

                // Get workspace
                const workspaceResponse = await axios.get(
                    `${this.baseUrl}/workspaces`,
                    { headers: this.headers }
                );

                if (workspaceResponse.status === 200 && workspaceResponse.data.length > 0) {
                    this.workspaceId = workspaceResponse.data[0].id;  // Use first workspace
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error("Error setting up Clockify:", error);
            return false;
        }
    }

    async getTimeEntries(startDate, endDate) {
        if (!this.apiKey || !this.workspaceId || !this.userId) {
            return [];
        }

        try {
            const params = {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                user: this.userId
            };

            const response = await axios.get(
                `${this.baseUrl}/workspaces/${this.workspaceId}/user/${this.userId}/time-entries`,
                {
                    headers: this.headers,
                    params: params
                }
            );

            if (response.status === 200) {
                return response.data;
            }
            return [];
        } catch (error) {
            console.error("Error getting time entries:", error);
            return [];
        }
    }

    generateDailyReport(entries) {
        if (!entries || entries.length === 0) {
            return "No time entries recorded for today.";
        }

        let totalDuration = 0;
        const projects = {};

        for (const entry of entries) {
            const startTime = new Date(entry.timeInterval.start);
            const endTime = new Date(entry.timeInterval.end);
            const duration = endTime - startTime;

            const project = entry.projectName || "No Project";
            const description = entry.description || "No description";

            if (!projects[project]) {
                projects[project] = {
                    totalTime: 0,
                    entries: []
                };
            }

            projects[project].totalTime += duration;
            projects[project].entries.push({
                description,
                duration
            });
            totalDuration += duration;
        }

        // Generate markdown report
        let report = "## Daily Time Report\n\n";
        report += `Total time tracked: ${this._formatDuration(totalDuration)}\n\n`;

        for (const [project, data] of Object.entries(projects)) {
            report += `### ${project}\n`;
            report += `Total: ${this._formatDuration(data.totalTime)}\n\n`;
            report += "Activities:\n";
            for (const entry of data.entries) {
                report += `- ${entry.description} (${this._formatDuration(entry.duration)})\n`;
            }
            report += "\n";
        }

        return report;
    }

    generateWeeklyReport(entries) {
        if (!entries || entries.length === 0) {
            return "No time entries recorded for this week.";
        }

        const days = {};
        let totalDuration = 0;

        for (const entry of entries) {
            const startTime = new Date(entry.timeInterval.start);
            const endTime = new Date(entry.timeInterval.end);
            const day = startTime.toLocaleDateString('en-US', { weekday: 'long' });
            const duration = endTime - startTime;

            if (!days[day]) {
                days[day] = {
                    totalTime: 0,
                    projects: {}
                };
            }

            const project = entry.projectName || "No Project";
            if (!days[day].projects[project]) {
                days[day].projects[project] = {
                    totalTime: 0,
                    entries: []
                };
            }

            days[day].totalTime += duration;
            days[day].projects[project].totalTime += duration;
            days[day].projects[project].entries.push({
                description: entry.description || "No description",
                duration
            });
            totalDuration += duration;
        }

        // Generate markdown report
        let report = "## Weekly Time Report\n\n";
        report += `Total time tracked: ${this._formatDuration(totalDuration)}\n\n`;

        for (const [day, data] of Object.entries(days)) {
            report += `### ${day}\n`;
            report += `Total: ${this._formatDuration(data.totalTime)}\n\n`;

            for (const [project, projData] of Object.entries(data.projects)) {
                report += `#### ${project}\n`;
                report += `Total: ${this._formatDuration(projData.totalTime)}\n`;
                report += "Activities:\n";
                for (const entry of projData.entries) {
                    report += `- ${entry.description} (${this._formatDuration(entry.duration)})\n`;
                }
                report += "\n";
            }
        }

        return report;
    }

    _formatDuration(duration) {
        const totalMinutes = Math.floor(duration / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${minutes}m`;
    }
}

module.exports = { ClockifyHandler }; 