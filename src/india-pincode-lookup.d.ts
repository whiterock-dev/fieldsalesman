declare module 'india-pincode-lookup' {
  export function lookup(pincode: string | number): Array<{
    officeName: string;
    pincode: number;
    taluk: string;
    districtName: string;
    stateName: string;
  }>;
}
