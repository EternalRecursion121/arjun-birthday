import requests
from datetime import datetime, timedelta
from typing import Optional, Dict, List

class ClockifyHandler:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.base_url = "https://api.clockify.me/api/v1"
        self.headers = {"X-Api-Key": api_key} if api_key else {}
        self.workspace_id = None
        self.user_id = None

    def setup(self) -> bool:
        """Initialize Clockify connection and get workspace ID"""
        if not self.api_key:
            return False
            
        try:
            # Get user info
            response = requests.get(f"{self.base_url}/user", headers=self.headers)
            if response.status_code == 200:
                self.user_id = response.json().get("id")
                
                # Get workspace
                response = requests.get(f"{self.base_url}/workspaces", headers=self.headers)
                if response.status_code == 200:
                    workspaces = response.json()
                    if workspaces:
                        self.workspace_id = workspaces[0]["id"]  # Use first workspace
                        return True
            return False
        except Exception as e:
            print(f"Error setting up Clockify: {e}")
            return False

    def get_time_entries(self, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Get time entries between dates"""
        if not all([self.api_key, self.workspace_id, self.user_id]):
            return []

        try:
            params = {
                "start": start_date.isoformat() + "Z",
                "end": end_date.isoformat() + "Z",
                "user": self.user_id
            }
            
            response = requests.get(
                f"{self.base_url}/workspaces/{self.workspace_id}/user/{self.user_id}/time-entries",
                headers=self.headers,
                params=params
            )
            
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Error getting time entries: {e}")
            return []

    def generate_daily_report(self, entries: List[Dict]) -> str:
        """Generate markdown report from time entries"""
        if not entries:
            return "No time entries recorded for today."
            
        total_duration = timedelta()
        projects = {}
        
        for entry in entries:
            start_time = datetime.fromisoformat(entry["timeInterval"]["start"].replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(entry["timeInterval"]["end"].replace("Z", "+00:00"))
            duration = end_time - start_time
            
            project = entry.get("projectName", "No Project")
            description = entry.get("description", "No description")
            
            if project not in projects:
                projects[project] = {
                    "total_time": timedelta(),
                    "entries": []
                }
            
            projects[project]["total_time"] += duration
            projects[project]["entries"].append({
                "description": description,
                "duration": duration
            })
            total_duration += duration

        # Generate markdown report
        report = "## Daily Time Report\n\n"
        report += f"Total time tracked: {self._format_duration(total_duration)}\n\n"
        
        for project, data in projects.items():
            report += f"### {project}\n"
            report += f"Total: {self._format_duration(data['total_time'])}\n\n"
            report += "Activities:\n"
            for entry in data["entries"]:
                report += f"- {entry['description']} ({self._format_duration(entry['duration'])})\n"
            report += "\n"
            
        return report

    def generate_weekly_report(self, entries: List[Dict]) -> str:
        """Generate weekly markdown report from time entries"""
        if not entries:
            return "No time entries recorded for this week."
            
        # Group entries by day
        days = {}
        total_duration = timedelta()
        
        for entry in entries:
            start_time = datetime.fromisoformat(entry["timeInterval"]["start"].replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(entry["timeInterval"]["end"].replace("Z", "+00:00"))
            day = start_time.strftime("%A")
            duration = end_time - start_time
            
            if day not in days:
                days[day] = {
                    "total_time": timedelta(),
                    "projects": {}
                }
            
            project = entry.get("projectName", "No Project")
            if project not in days[day]["projects"]:
                days[day]["projects"][project] = {
                    "total_time": timedelta(),
                    "entries": []
                }
            
            days[day]["total_time"] += duration
            days[day]["projects"][project]["total_time"] += duration
            days[day]["projects"][project]["entries"].append({
                "description": entry.get("description", "No description"),
                "duration": duration
            })
            total_duration += duration

        # Generate markdown report
        report = "## Weekly Time Report\n\n"
        report += f"Total time tracked: {self._format_duration(total_duration)}\n\n"
        
        for day, data in days.items():
            report += f"### {day}\n"
            report += f"Total: {self._format_duration(data['total_time'])}\n\n"
            
            for project, proj_data in data["projects"].items():
                report += f"#### {project}\n"
                report += f"Total: {self._format_duration(proj_data['total_time'])}\n"
                report += "Activities:\n"
                for entry in proj_data["entries"]:
                    report += f"- {entry['description']} ({self._format_duration(entry['duration'])})\n"
                report += "\n"
            
        return report

    def _format_duration(self, duration: timedelta) -> str:
        """Format timedelta into readable string"""
        total_minutes = duration.total_seconds() / 60
        hours = int(total_minutes // 60)
        minutes = int(total_minutes % 60)
        return f"{hours}h {minutes}m" 