export interface ArrivalTime {
  routeId: string;
  headsign: string;
  minutes: number;
  urgent: boolean;
}

export interface DirectionData {
  arrivals: ArrivalTime[];
}

export interface StationResult {
  id: string;
  name: string;
  walkMinutes: number;
  northbound: DirectionData;
  southbound: DirectionData;
}

export interface ArrivalsResponse {
  stations: StationResult[];
  fetchedAt: number; // unix ms
}
